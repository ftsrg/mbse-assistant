import "../agent_evaluation/hf_env.ts";
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { BenchmarkAgent } from "./agent_interface.ts";
import { DatasetKind } from "../tools/EndpointSparqlTool.ts";

/**
 * Builds a filesystem-friendly run id:
 * - uses local date/time (yyyy-mm-dd_hh-mm-ss)
 * - embeds the prompt base name
 *
 * This makes it easy to compare runs produced with different prompts.
 */
export function formatRunId(ts: Date, promptBaseName: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = ts.getFullYear();
  const mm = pad(ts.getMonth() + 1);
  const dd = pad(ts.getDate());
  const hh = pad(ts.getHours());
  const mi = pad(ts.getMinutes());
  const ss = pad(ts.getSeconds());

  // Remove characters that are illegal in filenames, collapse whitespace.
  const safePrompt = promptBaseName
    .replace(/[<>:"/\\|?*\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}__${safePrompt}`;
}

/**
 * Reads the first non-empty, non-comment line from a text file.
 * We use this for endpoint files, where the first actual line is the endpoint URL.
 */
export async function readFirstNonEmptyLine(filePath: string): Promise<string> {
  const text = await fs.readFile(filePath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Support common comment styles.
    if (line.startsWith("#") || line.startsWith("//")) continue;
    return line;
  }
  throw new Error(`No endpoint found in file: ${filePath}`);
}

/**
 * Loads a system prompt from either:
 * - a TS/JS module (exports a string), or
 * - a plain-text file.
 *
 * Returns:
 * - promptText: actual prompt content
 * - promptName: base file name (used in run id formatting)
 */
export async function loadPromptFromFile(filePath: string): Promise<{ promptText: string; promptName: string }> {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath, ext);

  if ([".ts", ".js", ".mjs", ".cjs"].includes(ext)) {
    const modUrl = pathToFileURL(path.resolve(filePath)).href;
    const mod: any = await import(modUrl);

    // Prefer a few known export names first (keeps prompts consistent across files).
    const preferred = [
      mod.behaviourPrompt,
      mod.BPMN_behaviourPrompt,
      mod.default,
      mod.systemPrompt,
      mod.prompt,
    ].filter((x) => typeof x === "string") as string[];

    let promptText: string | null = preferred.length ? preferred[0] : null;

    // Fallback: take the first exported string value.
    if (!promptText) {
      for (const v of Object.values(mod)) {
        if (typeof v === "string") {
          promptText = v;
          break;
        }
      }
    }

    if (!promptText) throw new Error(`No string prompt export found in: ${filePath}`);
    return { promptText, promptName: base };
  }

  // Plain-text prompt file.
  return { promptText: await fs.readFile(filePath, "utf8"), promptName: base };
}

/**
 * Reads questions from a 2-column TSV:
 *   q001<TAB>Question text...
 */
export async function readQuestionsTsv(filePath: string): Promise<Array<{ id: string; question: string }>> {
  const raw = await fs.readFile(filePath, "utf8");
  // Remove UTF-8 BOM if present (common on Windows editors).
  const text = raw.replace(/^\uFEFF/, "");

  const out: Array<{ id: string; question: string }> = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim()) continue;

    const parts = ln.split("\t");
    if (parts.length < 2) continue;

    const id = parts[0].trim();
    const q = parts.slice(1).join("\t").trim();
    if (!id || !q) continue;

    out.push({ id, question: q });
  }

  return out;
}

/**
 * Best-effort dataset kind inference.
 * This controls the output directory prefix: automated_test_results/<dataset>/...
 */
export function inferDatasetKind(questionsFile: string, endpointFile: string, endpointUrl: string): DatasetKind {
  const s = `${questionsFile} ${endpointFile} ${endpointUrl}`.toLowerCase();
  if (s.includes("bpmn")) return "bpmn";
  if (s.includes("sysml")) return "sysml";
  return "generic";
}

/**
 * Extract output folder name from Fuseki endpoint URL.
 * We take the part between "/3030/" and "/sparql".
 */
export function inferOutputDatasetName(endpointUrl: string): string {
  try {
    const u = new URL(endpointUrl);
    const m = u.pathname.match(/^\/([^/]+)\/sparql\/?$/i);
    if (m?.[1]) return m[1];
  } catch {
    // ignore and fall back below
  }
  return "generic";
}

/**
 * Creates a unique directory for a run.
 * - If dirPath doesn't exist -> create it.
 * - If it exists -> create dirPath__r01, __r02, ...
 *
 * This avoids overwriting previous runs when timestamp collisions happen
 * (e.g., two runs started within the same second).
 */
export async function ensureUniqueDir(dirPath: string): Promise<string> {
  // Helper: check existence without throwing.
  const exists = async (p: string) => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  };

  if (!(await exists(dirPath))) {
    await fs.mkdir(dirPath, { recursive: true });
    return dirPath;
  }

  for (let i = 1; i <= 99; i++) {
    const suffix = `__r${String(i).padStart(2, "0")}`;
    const candidate = dirPath + suffix;
    if (!(await exists(candidate))) {
      await fs.mkdir(candidate, { recursive: true });
      return candidate;
    }
  }

  throw new Error(`Could not create unique dir based on: ${dirPath}`);
}

/**
 * One loaded benchmark question.
 */
export type BenchmarkQuestion = {
  id: string;
  question: string;
};

/**
 * Fully resolved benchmark inputs after reading files and inferring metadata.
 */
export type ResolvedRunInputs = {
  questionsFile: string;
  endpointFile: string;
  systemPromptFile: string;
  endpointUrl: string;
  promptText: string;
  promptName: string;
  questions: BenchmarkQuestion[];
  datasetKind: DatasetKind;
  outputDatasetName: string;
};

/**
 * Filesystem and metadata context for one benchmark run.
 */
export type RunContext = {
  runStarted: Date;
  runId: string;
  runDir: string;
  questionsDir: string;
  runMeta: any;
};

/**
 * Aggregated counters collected while running one benchmark run.
 */
export type RunCounters = {
  okCount: number;
  errCount: number;
  timeoutCount: number;
  runInputTokens: number;
  runOutputTokens: number;
  runTotalTokens: number;
};

/**
 * Resolve all benchmark inputs from CLI-provided file paths.
 *
 * Responsibilities:
 * - read endpoint URL
 * - load system prompt text
 * - load benchmark questions
 * - infer dataset kind for the tool layer
 * - infer dataset output folder name
 */
export async function resolveRunInputs(args: {
  questionsFile: string;
  endpointFile: string;
  systemPromptFile: string;
}): Promise<ResolvedRunInputs> {
  const endpointUrl = await readFirstNonEmptyLine(args.endpointFile);
  const { promptText, promptName } = await loadPromptFromFile(args.systemPromptFile);
  const questions = await readQuestionsTsv(args.questionsFile);

  if (questions.length === 0) {
    throw new Error(`No questions loaded from: ${args.questionsFile}`);
  }

  const datasetKind = inferDatasetKind(args.questionsFile, args.endpointFile, endpointUrl);
  const outputDatasetName = inferOutputDatasetName(endpointUrl);

  return {
    questionsFile: args.questionsFile,
    endpointFile: args.endpointFile,
    systemPromptFile: args.systemPromptFile,
    endpointUrl,
    promptText,
    promptName,
    questions,
    datasetKind,
    outputDatasetName,
  };
}

/**
 * Create run directories and the initial run.meta.json object.
 *
 * Responsibilities:
 * - generate run id
 * - create run folder
 * - create questions subfolder
 * - build initial run meta object
 * - persist initial run.meta.json
 */
export async function createRunContext(args: {
  inputs: ResolvedRunInputs;
  modelName: string;
  temperature: number;
  maxSteps: number;
}): Promise<RunContext> {
  const runStarted = new Date();
  const runId = formatRunId(runStarted, args.inputs.promptName);

  const outRoot = path.resolve(
    process.cwd(),
    "automated_test_results",
    args.inputs.outputDatasetName
  );

  const runDir = await ensureUniqueDir(path.join(outRoot, "runs", runId));
  const questionsDir = path.join(runDir, "questions");
  await fs.mkdir(questionsDir, { recursive: true });

  const runMeta: any = {
    schemaVersion: "run.meta.v2",
    runId: path.basename(runDir),
    durationMs: null,
    inputs: {
      questionsFile: path
        .relative(process.cwd(), path.resolve(args.inputs.questionsFile))
        .replaceAll("\\", "/"),
      questionsCount: args.inputs.questions.length,
      endpointFile: path
        .relative(process.cwd(), path.resolve(args.inputs.endpointFile))
        .replaceAll("\\", "/"),
      endpointUrl: args.inputs.endpointUrl,
      systemPromptFile: path
        .relative(process.cwd(), path.resolve(args.inputs.systemPromptFile))
        .replaceAll("\\", "/"),
      systemPromptName: args.inputs.promptName,
    },
    llm: {
      model: args.modelName,
      temperature: args.temperature,
      maxSteps: args.maxSteps,
    },
    output: {
      rootDir: path.relative(process.cwd(), runDir).replaceAll("\\", "/"),
      questionsDir: "questions",
    },
  };

  await fs.writeFile(
    path.join(runDir, "run.meta.json"),
    JSON.stringify(runMeta, null, 2),
    "utf8"
  );

  return {
    runStarted,
    runId,
    runDir,
    questionsDir,
    runMeta,
  };
}

/**
 * Run all questions sequentially and write one qNNN.json per question.
 *
 * Important design rule:
 * - the agent returns a raw execution result
 * - this runner function owns the benchmark log file structure
 */
export async function runQuestionSet(args: {
  agent: BenchmarkAgent;
  questions: BenchmarkQuestion[];
  questionsDir: string;
  runId: string;
}): Promise<RunCounters> {
  let okCount = 0;
  let errCount = 0;
  let timeoutCount = 0;

  let runInputTokens = 0;
  let runOutputTokens = 0;
  let runTotalTokens = 0;

  for (const q of args.questions) {
    const result = await args.agent.runOneQuestion({
      questionText: q.question,
    });

    const qObj = {
      top: {
        schemaVersion: "question.raw.v2",
        runMetaRelPath: "../run.meta.json",
      },
      meta: {
        questionId: q.id,
        question: q.question,
        durationMs: result.durationMs,
        status: result.status,
        finalAnswer: result.finalAnswer,
        error: result.error,
        tokenUsage: result.tokenUsage,
      },
      conversation: {
        traceVersion: "conversation.v2",
        events: result.events,
        counts: result.counts,
      },
    };

    await fs.writeFile(
      path.join(args.questionsDir, `${q.id}.json`),
      JSON.stringify(qObj, null, 2),
      "utf8"
    );

    const st = qObj?.meta?.status;
    if (st === "OK") okCount++;
    else if (st === "TIMEOUT") timeoutCount++;
    else errCount++;

    runInputTokens += qObj?.meta?.tokenUsage?.inputTokens ?? 0;
    runOutputTokens += qObj?.meta?.tokenUsage?.outputTokens ?? 0;
    runTotalTokens += qObj?.meta?.tokenUsage?.totalTokens ?? 0;

    console.log(`[${args.runId}] ${q.id} -> ${st}`);
  }

  return {
    okCount,
    errCount,
    timeoutCount,
    runInputTokens,
    runOutputTokens,
    runTotalTokens,
  };
}

/**
 * Finalize run.meta.json after all questions have finished.
 *
 * Responsibilities:
 * - compute wall-clock duration
 * - attach status counters
 * - attach run-level token usage
 * - overwrite run.meta.json with final values
 */
export async function finalizeRunMeta(args: {
  runDir: string;
  runMeta: any;
  runStarted: Date;
  counters: RunCounters;
}): Promise<void> {
  const runFinished = new Date();
  const durationMs = runFinished.getTime() - args.runStarted.getTime();

  args.runMeta.durationMs = durationMs;
  args.runMeta.counts = {
    ok: args.counters.okCount,
    error: args.counters.errCount,
    timeout: args.counters.timeoutCount,
  };
  args.runMeta.tokenUsage = {
    inputTokens: args.counters.runInputTokens,
    outputTokens: args.counters.runOutputTokens,
    totalTokens: args.counters.runTotalTokens,
  };

  await fs.writeFile(
    path.join(args.runDir, "run.meta.json"),
    JSON.stringify(args.runMeta, null, 2),
    "utf8"
  );
}