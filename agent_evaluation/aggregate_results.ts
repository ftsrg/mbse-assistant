import "./hf_env";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { safeRel } from "./evaluation_core.js";
import { exists } from "./evaluation_core.js";
import { readJson } from "./evaluation_core.js";

/**
 * Aggregates benchmark evaluation outputs into a single flat CSV table.
 *
 * Default behavior:
 * - aggregates ONLY the latest evaluation of each run
 *
 * Optional behavior:
 * - with --all (or -all), aggregates ALL evaluations of each run
 *
 * What this script reads
 * - Root folder (default: `automated_test_results/`)
 * - Dataset folders under root (e.g., `sap-sam-export_aggregated/`, `sysml/`)
 * - Run folders under each dataset:
 *     <dataset>/runs/<runId>/
 *       run.meta.json
 *       evaluations/LATEST.json
 *       evaluations/<evalId>/metrics/*.jsonl
 * - Optional evaluation config:
 *     evaluation_config.json
 *
 * What this script writes
 * - A timestamped summary folder:
 *     <root>/_summary/<timestamp>/
 *       metrics_long.csv
 *
 * How to run:
 *   npx tsx agent_evaluation/aggregate_results.ts automated_test_results
 *   npx tsx agent_evaluation/aggregate_results.ts automated_test_results --all
 *
 * Output schema
 * - runId
 * - llmModel
 * - datasetKind
 * - evalId
 * - questionSet
 * - questionId
 * - metric
 * - value
 * - status
 */

type Row = {
  runId: string;
  llmModel: string;
  datasetKind: string;
  evalId: string;
  questionSet: string;
  questionId: string;
  metric: string;
  value: number | null;
  status: string;
};

type EvaluationConfig = {
  version?: number;
  questionSets?: Record<
    string,
    {
      questionSetId?: string;
      datasetKind?: string;
    }
  >;
};


type Args = {
  root: string;
  includeAllEvaluations: boolean;
};

function parseArgs(argv: string[]): Args {
  let root = "automated_test_results";
  let includeAllEvaluations = false;

  for (const arg of argv) {
    if (arg === "--all" || arg === "-all") {
      includeAllEvaluations = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }

    root = arg;
  }

  return { root, includeAllEvaluations };
}

/**
 * Read a JSONL file into memory.
 * Parses each non-empty line as JSON.
 */
async function readJsonl(p: string): Promise<any[]> {
  const txt = await fs.readFile(p, "utf8");
  const out: any[] = [];
  for (const ln of txt.split(/\r?\n/)) {
    const s = ln.trim();
    if (!s) continue;
    out.push(JSON.parse(s));
  }
  return out;
}

/**
 * List direct child directories of a given path.
 * Returns an empty list if the folder does not exist.
 */
async function listDirs(p: string): Promise<string[]> {
  try {
    const ents = await fs.readdir(p, { withFileTypes: true });
    return ents.filter((e) => e.isDirectory()).map((e) => path.join(p, e.name));
  } catch {
    return [];
  }
}

/**
 * Convert rows (objects) into a CSV string.
 */
function toCsv(rows: Record<string, any>[]) {
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

/**
 * Extract runId from the best available source:
 * 1) evaluation manifest.json
 * 2) run.meta.json
 * 3) folder name fallback
 */
function pickRunId(manifest: any | null, runMeta: any | null, runDir: string): string {
  return String(manifest?.runId ?? runMeta?.runId ?? path.basename(runDir));
}

/**
 * Extract LLM model name from run meta.
 */
function pickLlmModel(runMeta: any | null): string {
  return String(runMeta?.llm?.model ?? "");
}

/**
 * Extract metric name from the best available source:
 * 1) record.metric.name
 * 2) record.metric (string)
 * 3) JSONL filename base
 */
function pickMetricName(rec: any, metricFilePath: string): string {
  const fromRec =
    rec?.metric?.name ??
    (typeof rec?.metric === "string" ? rec.metric : null) ??
    null;

  return String(fromRec ?? path.basename(metricFilePath, ".jsonl"));
}

/**
 * Normalize path separators so config keys like
 * `questions/bpmn_questions.txt` match across Windows/Linux.
 */
function normalizeRelPath(p: string): string {
  return String(p ?? "").replaceAll("\\", "/").trim();
}

/**
 * Try to load evaluation_config.json.
 * We first check next to the script, then the current working directory.
 * Missing config is allowed.
 */
async function loadEvaluationConfig(): Promise<EvaluationConfig | null> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(scriptDir, "evaluation_config.json"),
    path.resolve(process.cwd(), "evaluation_config.json"),
  ];

  for (const p of candidates) {
    if (await exists(p)) {
      return await readJson<EvaluationConfig>(p);
    }
  }

  return null;
}

/**
 * Resolve question-set id strictly from evaluation_config.json.
 * No fallback is used.
 */
function pickQuestionSet(runMeta: any | null, config: EvaluationConfig | null): string {
  const qFile = normalizeRelPath(runMeta?.inputs?.questionsFile ?? "");
  if (!qFile) {
    throw new Error("Missing run.meta.inputs.questionsFile; cannot resolve questionSetId from evaluation_config.json");
  }

  if (!config?.questionSets) {
    throw new Error(`evaluation_config.json is missing or has no questionSets; cannot resolve questionSetId for ${qFile}`);
  }

  const fromConfig = config.questionSets[qFile]?.questionSetId;
  if (!fromConfig) {
    throw new Error(`No questionSetId mapping found in evaluation_config.json for questions file: ${qFile}`);
  }

  return String(fromConfig);
}

async function resolveEvalIds(runDir: string, includeAllEvaluations: boolean): Promise<string[]> {
  const evalsRoot = path.join(runDir, "evaluations");

  if (!(await exists(evalsRoot))) {
    return [];
  }

  if (!includeAllEvaluations) {
    const latestPath = path.join(evalsRoot, "LATEST.json");
    if (!(await exists(latestPath))) {
      return [];
    }

    const latest = await readJson(latestPath);
    const evalId = String(latest?.latestEvalId ?? "").trim();
    return evalId ? [evalId] : [];
  }

  const entries = await fs.readdir(evalsRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  const includeAllEvaluations = args.includeAllEvaluations;

  const ts = new Date().toISOString().replace(/[:]/g, "-").slice(0, 19);
  const outDir = path.join(root, "_summary", ts);
  await fs.mkdir(outDir, { recursive: true });

  const config = await loadEvaluationConfig();

  // Dataset folders under root (e.g. sap-sam-export_aggregated, sysml).
  // Skip internal folders like _summary.
  const datasets = await listDirs(root);
  const rows: Row[] = [];

  for (const dsDir of datasets) {
    const datasetKind = path.basename(dsDir);
    if (datasetKind.startsWith("_")) continue;

    const runsDir = path.join(dsDir, "runs");
    const runDirs = await listDirs(runsDir);

    for (const runDir of runDirs) {
      const runMetaPath = path.join(runDir, "run.meta.json");
      const runMeta = (await exists(runMetaPath)) ? await readJson(runMetaPath) : null;

      const evalIds = await resolveEvalIds(runDir, includeAllEvaluations);
      if (evalIds.length === 0) continue;

      const llmModel = pickLlmModel(runMeta);
      const questionSet = pickQuestionSet(runMeta, config);

      for (const evalId of evalIds) {
        const evalDir = path.join(runDir, "evaluations", evalId);
        const manifestPath = path.join(evalDir, "manifest.json");
        const manifest = (await exists(manifestPath)) ? await readJson(manifestPath) : null;

        const runId = pickRunId(manifest, runMeta, runDir);

        const metricsDir = path.join(evalDir, "metrics");
        if (!(await exists(metricsDir))) continue;

        const metricFiles = (await fs.readdir(metricsDir))
          .filter((f) => f.endsWith(".jsonl"))
          .sort()
          .map((f) => path.join(metricsDir, f));

        for (const mf of metricFiles) {
          const recs = await readJsonl(mf);

          for (const r of recs) {
            const questionId = String(r?.questionId ?? "");
            if (!questionId) continue;

            const metric = pickMetricName(r, mf);
            const value = typeof r?.value === "number" ? r.value : null;
            const status = String(r?.status ?? "UNKNOWN");

            rows.push({
              runId,
              llmModel,
              datasetKind,
              evalId,
              questionSet,
              questionId,
              metric,
              value,
              status,
            });
          }
        }
      }

    }
  }

  await fs.writeFile(path.join(outDir, "metrics_results.csv"), toCsv(rows), "utf8");

  console.log("DONE.");
  console.log("Summary dir:", safeRel(outDir));
  console.log(" - metrics_results.csv");
  console.log(`Mode: ${includeAllEvaluations ? "ALL evaluations" : "LATEST only"}`);
  console.log(`Rows written: ${rows.length}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
