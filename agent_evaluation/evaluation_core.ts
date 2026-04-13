import fs from "node:fs/promises";
import path from "node:path";
import { createKeywordProvider } from "./keyword_provider";

import { getMetric, listMetrics } from "../evaluation_metrics";
import {
  materializeResolvedPaths,
  resolveEvaluationContext,
} from "./evaluation_resolver";
import { createModelElementProvider } from "./model_element_provider";

export type EvaluateRunArgs = {
  runDir: string;
  evaluationConfigPath: string;
};

export type EvaluateRunResult = {
  evalId: string;
  outDir: string;
  runId: string;
  datasetName: string;
  datasetKind: string;
  questionSetId: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export function safeRel(p: string): string {
  return path.relative(process.cwd(), path.resolve(p)).replaceAll("\\", "/");
}

export function normalizeRelPath(p: string): string {
  return String(p ?? "").replaceAll("\\", "/").trim();
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T = any>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

async function writeJson(p: string, obj: any): Promise<void> {
  await fs.writeFile(p, JSON.stringify(obj, null, 2), "utf8");
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJsonlLine(handle: fs.FileHandle, obj: any): Promise<void> {
  await handle.write(`${JSON.stringify(obj)}\n`);
}

/**
 * Build an evaluation id from the local timestamp down to seconds.
 * Format:
 *   yyyy-mm-dd_hh-mm-ss
 */
function formatEvalId(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

/**
 * Load expected answers from a TSV file:
 *   q001<TAB>Expected answer...
 */
async function loadExpected(expectedFile: string): Promise<Record<string, string>> {
  await fs.access(expectedFile);

  const out: Record<string, string> = {};
  const txt = await fs.readFile(expectedFile, "utf8");

  for (const raw of txt.split(/\r?\n/)) {
    if (!raw.trim()) continue;

    const i = raw.indexOf("\t");
    if (i < 0) continue;

    const id = raw.slice(0, i).trim();
    const exp = raw.slice(i + 1).trim();

    if (id) out[id] = exp;
  }

  return out;
}

/**
 * Evaluate a single run directory using the external evaluation config.
 * This function contains the full shared evaluation logic and can be called
 * both from the single-run CLI and the batch CLI.
 */
export async function evaluateRun(args: EvaluateRunArgs): Promise<EvaluateRunResult> {
  const runDir = args.runDir;
  const evaluationConfigPath = args.evaluationConfigPath;
  const runMetaPath = path.join(runDir, "run.meta.json");

  const runMeta = await readJson<any>(runMetaPath);

  const resolved = await resolveEvaluationContext({
    runMetaPath,
    configPath: evaluationConfigPath,
  });

  const resolvedPaths = materializeResolvedPaths(evaluationConfigPath, resolved);
  const expectedFile = resolvedPaths.expectedAnswersFileAbs;
  const keywordProvider = await createKeywordProvider(
    resolvedPaths.expectedKeywordsFileAbs ?? null
  );
  const modelElementProvider = await createModelElementProvider(
    resolvedPaths.modelElementURIsFileAbs ?? null
  );

  let expectedMap: Record<string, string>;
  try {
    expectedMap = await loadExpected(expectedFile);
  } catch {
    throw new Error(`Expected answers file not found: ${expectedFile}`);
  }

  const metrics = listMetrics().map((n) => {
    const m = getMetric(n);
    if (!m) throw new Error(`Unknown metric in registry: ${n}`);
    return m;
  });

  const evalId = formatEvalId(new Date());
  const outDir = path.join(runDir, "evaluations", evalId);
  const metricsDir = path.join(outDir, "metrics");
  await ensureDir(metricsDir);

  const manifest: any = {
    schemaVersion: "evaluation.manifest.v2",
    evalId,
    runId: runMeta?.runId ?? path.basename(runDir),
    inputs: {
      runDir: safeRel(runDir),
      runMeta: safeRel(runMetaPath),
      evaluationConfig: safeRel(evaluationConfigPath),

      datasetName: resolved.datasetName,
      datasetKind: resolved.datasetKind,
      questionSetId: resolved.questionSetId,
      questionsFile: resolved.questionsFile,
      endpointUrl: resolved.endpointUrl,
      modelName: resolved.modelName,

      expectedFile: safeRel(expectedFile),
      expectedCount: Object.keys(expectedMap).length,
      expectedKeywordsFile: resolvedPaths.expectedKeywordsFileAbs
        ? safeRel(resolvedPaths.expectedKeywordsFileAbs)
        : null,
    },
    metrics: metrics.map((m) => ({ name: m.name })),
  };

  await writeJson(path.join(outDir, "manifest.json"), manifest);

  const handles: Record<string, fs.FileHandle> = {};
  try {
    for (const m of metrics) {
      handles[m.name] = await fs.open(path.join(metricsDir, `${m.name}.jsonl`), "w");
    }

    const qDir = path.join(runDir, "questions");
    if (!(await exists(qDir))) {
      throw new Error(`Missing questions directory: ${qDir}`);
    }

    const files = (await fs.readdir(qDir))
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .sort();

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const qObj = await readJson<any>(path.join(qDir, f));

      const questionId: string = qObj?.meta?.questionId ?? path.basename(f, ".json");
      const question: string = qObj?.meta?.question ?? "";
      const got: string = qObj?.meta?.finalAnswer ?? "";

      if (!(questionId in expectedMap)) {
        throw new Error(
          `Missing expected answer for questionId='${questionId}' in file: ${expectedFile}`
        );
      }

      const expected: string = expectedMap[questionId];
      const keywords: string[] = keywordProvider.getKeywords(questionId);
      const modelElementURIs: string[] = modelElementProvider.getModelElementIds(questionId);

      for (const m of metrics) {
        const input = {
          runId: manifest.runId,
          datasetName: resolved.datasetName,
          datasetKind: resolved.datasetKind,
          questionSetId: resolved.questionSetId,
          questionId,
          question,
          got,
          expected,
          keywords,
          modelElementURIs,
        };

        const score = await m.score(input as any);

        await writeJsonlLine(handles[m.name], {
          questionId,
          metric: { name: m.name },
          scoredAt: nowIso(),
          value: score.value,
          status: score.status,
          details: score.details ?? null,
          error: (score as any).error ?? null,
        });
      }

      process.stdout.write(`\rEvaluated ${questionId} (${i + 1}/${files.length})`);
    }

    process.stdout.write("\n");
  } finally {
    for (const h of Object.values(handles)) {
      try {
        await h.close();
      } catch {
        // ignore close failures
      }
    }
  }

  manifest.finishedAt = nowIso();
  await writeJson(path.join(outDir, "manifest.json"), manifest);

  await ensureDir(path.join(runDir, "evaluations"));
  await writeJson(path.join(runDir, "evaluations", "LATEST.json"), {
    latestEvalId: evalId,
  });

  console.log(`DONE. Evaluation output: ${safeRel(outDir)}`);

  return {
    evalId,
    outDir,
    runId: manifest.runId,
    datasetName: resolved.datasetName,
    datasetKind: resolved.datasetKind,
    questionSetId: resolved.questionSetId,
  };
}