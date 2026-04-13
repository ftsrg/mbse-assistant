import "../agent_evaluation/hf_env.ts";
import "dotenv/config";
import type { BenchmarkAgent } from "./agent_interface.ts";
import { createToolLoopAgent } from "./agent.ts";
import { resolveRunInputs, createRunContext, runQuestionSet, finalizeRunMeta } from "./run_functions.ts";
/**
 * Benchmark runner.
 *
 * What this script does:
 * - Loads a list of questions from a .txt file.
 * - Loads a SPARQL endpoint URL from a small text file.
 * - Loads a system prompt from a TS/JS module (exported string) or plain text file.
 * - Creates an agent instance (see `automated_testing/agent.ts`).
 * - For each question, calls the agent and writes a per-question trace (`qNNN.json`).
 * - Writes a `run.meta.json` that captures run-level configuration and counts.
 *
 * CLI:
 *   npx tsx agent_workflow/run_questions.ts <questions.txt> <endpoint.txt> <systemPromptFile> [modelName]
 *
 * Input formats:
 * - questions.txt: 2 columns -> q001<TAB>Question text
 * - endpoint.txt: first non-empty, non-comment line is the SPARQL endpoint URL
 * - systemPromptFile:
 *   - TS/JS module OR
 *   - a plain-text file with the prompt content
 *
 * Output:
 *   automated_test_results/<dataset>/runs/<runId>/run.meta.json
 *   automated_test_results/<dataset>/runs/<runId>/questions/qNNN.json
 */


/**
 * Main entry point:
 * - Parses CLI args
 * - Loads endpoint URL, prompt, and questions
 * - Creates the output directories
 * - Writes run.meta.json
 * - Runs each question (delegated to the agent) and writes qNNN.json
 * - Updates run.meta.json with duration and counts at the end
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error(
      "Usage: npx tsx agent_workflow/run_questions.ts <questions.txt> <endpoint.txt> <systemPromptFile> [modelName]",
    );
    process.exit(2);
  }

  const questionsFile = args[0];
  const endpointFile = args[1];
  const systemPromptFile = args[2];
  const modelArg = args[3];

  
  /**
   * Benchmark models to test.
   *
   * All of them are called through OpenRouter via ChatOpenAI,
   * so only the model name changes between runs.
   */
  const defaultModelNames = [
    "anthropic/claude-opus-4.6", // Claude Opus 4.6
    "google/gemini-3.1-flash-lite-preview", // Gemini 3.1 Flash Lite
    "qwen/qwen3.5-plus-02-15", // Qwen 3.5 Plus
    "openai/gpt-5.4-nano", // GPT-5.4-nano
    "minimax/minimax-m2.5", // MiniMax M2.5
  ];


  const modelNames = modelArg ? [modelArg] : defaultModelNames;

  /**
   * Resolve all shared run inputs once.
   *
   * These inputs are reused for every model:
   * - question set
   * - endpoint
   * - system prompt
   */
  const inputs = await resolveRunInputs({
    questionsFile,
    endpointFile,
    systemPromptFile,
  });

  /**
   * Shared generation settings for now.
   *
   * Later these can also be turned into loops if needed.
   */
  const temperature = Number(process.env.LLM_TEMPERATURE ?? "0");
  const maxSteps = Number(process.env.MAX_STEPS ?? "10000");

  /**
   * Run the full benchmark once for each model.
   *
   * Each model gets:
   * - a separate run directory
   * - a separate run.meta.json
   * - separate qNNN.json files
   */
  for (const modelName of modelNames) {
    console.log(`\n=== STARTING MODEL: ${modelName} ===`);

    /**
     * Create the run directory structure and initial run metadata
     * for the current model run.
     */
    const runCtx = await createRunContext({
      inputs,
      modelName,
      temperature,
      maxSteps,
    });

    /**
     * Create the benchmark agent for the current model.
     */
    const agent: BenchmarkAgent = createToolLoopAgent({
      endpointUrl: inputs.endpointUrl,
      datasetKind: inputs.datasetKind,
      systemPromptText: inputs.promptText,
      modelName,
      temperature,
      maxSteps,
    });

    /**
     * Execute the whole question set for the current model.
     */
    const counters = await runQuestionSet({
      agent,
      questions: inputs.questions,
      questionsDir: runCtx.questionsDir,
      runId: runCtx.runId,
    });

    /**
     * Finalize run.meta.json for the current model run.
     */
    await finalizeRunMeta({
      runDir: runCtx.runDir,
      runMeta: runCtx.runMeta,
      runStarted: runCtx.runStarted,
      counters,
    });

    console.log(`DONE FOR MODEL: ${modelName}`);
    console.log(`Output: ${runCtx.runDir}\n`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
