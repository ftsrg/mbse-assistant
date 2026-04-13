import "./hf_env";
import fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config";

import { evaluateRun, normalizeRelPath, readJson, safeRel } from "./evaluation_core";

type Args = {
  runsDir: string;
  evaluationConfigPath: string;
  model?: string;
  questionsFile?: string;
};

/**
 * Batch evaluator for benchmark runs.
 *
 * What this script does:
 * - Scans a runs directory and finds subdirectories that contain `run.meta.json`.
 * - Optionally filters runs by:
 *   - LLM model name
 *   - questions file
 * - For each selected run, directly calls the shared evaluation function.
 *
 * Why this exists:
 * - Multiple runs may exist under the same dataset folder.
 * - Those runs may differ by:
 *   - model
 *   - question set
 *   - prompt
 * - Expected answers are no longer selected from one shared directory argument.
 * - Instead, each run is evaluated through the same external
 *   `evaluation_config.json`, which resolves the correct references
 *   from the original `run.meta.json`.
 *
 * Usage:
 *   npx tsx agent_workflow_and_testing/evaluate_all.ts <runsDir> <evaluation_config.json>
 *
 * Optional filters:
 *   --model <modelName>
 *   --questions-file <repo-relative-path>
 *
 * Example:
 *   npx tsx agent_evaluation/evaluate_all.ts automated_test_results\sysml\runs agent_evaluation\evaluation_config.json --model openai/gpt-5.4-nano --questions-file questions/bpmn_questions.txt
 */
async function listRunDirs(runsDir: string): Promise<string[]> {
  const out: string[] = [];

  try {
    const ents = await fs.readdir(runsDir, { withFileTypes: true });

    for (const e of ents) {
      if (!e.isDirectory()) continue;

      const runDir = path.join(runsDir, e.name);
      try {
        await fs.access(path.join(runDir, "run.meta.json"));
        out.push(runDir);
      } catch {
        // skip non-run directories
      }
    }
  } catch {
    // missing runs dir -> none
  }

  return out.sort();
}

function parseArgs(argv: string[]): Args {
  if (argv.length < 2) {
    throw new Error(
      "Usage: npx tsx agent_workflow_and_testing/evaluate_all.ts <runsDir> <evaluation_config.json> [--model <name>] [--questions-file <path>]"
    );
  }

  const args: Args = {
    runsDir: argv[0],
    evaluationConfigPath: argv[1],
  };

  let i = 2;
  while (i < argv.length) {
    const a = argv[i];

    if (a === "--model") {
      if (i + 1 >= argv.length) {
        throw new Error("Missing value after --model");
      }
      args.model = argv[i + 1];
      i += 2;
      continue;
    }

    if (a === "--questions-file") {
      if (i + 1 >= argv.length) {
        throw new Error("Missing value after --questions-file");
      }
      args.questionsFile = normalizeRelPath(argv[i + 1]);
      i += 2;
      continue;
    }

    throw new Error(`Unknown argument: ${a}`);
  }

  return args;
}

function matchesFilters(runMeta: any, args: Args): boolean {
  const modelName = String(runMeta?.llm?.model ?? "").trim();
  const questionsFile = normalizeRelPath(runMeta?.inputs?.questionsFile ?? "");

  if (args.model && modelName !== args.model) {
    return false;
  }

  if (args.questionsFile && questionsFile !== args.questionsFile) {
    return false;
  }

  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const runDirs = await listRunDirs(args.runsDir);
  console.log(`Found ${runDirs.length} runs under ${safeRel(args.runsDir)}.`);

  const selected: string[] = [];

  for (const runDir of runDirs) {
    const runMetaPath = path.join(runDir, "run.meta.json");
    const runMeta = await readJson<any>(runMetaPath);

    if (!matchesFilters(runMeta, args)) {
      continue;
    }

    selected.push(runDir);
  }

  console.log(`Selected ${selected.length} runs for evaluation.`);

  if (args.model) {
    console.log(`  Filter model: ${args.model}`);
  }

  if (args.questionsFile) {
    console.log(`  Filter questionsFile: ${args.questionsFile}`);
  }

  for (const runDir of selected) {
    console.log(`\n== Evaluating: ${safeRel(runDir)} ==`);
    await evaluateRun({
      runDir,
      evaluationConfigPath: args.evaluationConfigPath,
    });
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});