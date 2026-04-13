import "./hf_env";
import { pathToFileURL } from "node:url";
import "dotenv/config";

import { evaluateRun } from "./evaluation_core";

type Args = {
  runDir: string;
  evaluationConfigPath: string;
};

/**
 * Single-run evaluator.
 *
 * What this script does:
 * - Reads one existing benchmark run directory.
 * - Loads the run-level metadata from `run.meta.json`.
 * - Resolves the evaluation context from an external `evaluation_config.json`.
 * - Selects the correct expected answers / expected keywords files based on:
 *   - the original `questionsFile`
 *   - the endpoint URL
 *   - the external evaluation mapping
 * - Evaluates every `questions/qNNN.json` result with the configured metric registry.
 * - Writes one evaluation output under:
 *     evaluations/<evalId>/
 *       manifest.json
 *       metrics/<metric>.jsonl
 * - Updates `evaluations/LATEST.json` to point to the newest evaluation.
 *
 * Why this exists:
 * - Existing benchmark runs cannot be re-generated just to add more metadata.
 * - Therefore evaluation-time resolution is done outside the original run schema.
 * - This avoids heuristic expected-file selection such as:
 *     datasetKind -> <datasetKind>_answers.txt
 * - Instead, the evaluator uses the original run metadata together with
 *   a deterministic external config file.
 *
 * Usage:
 *   npx tsx agent_evaluation/evaluate_run.ts <runDir> <evaluation_config.json>
 *
 * Example:
 *   npx tsx agent_evaluation/evaluate_run.ts automated_test_results\sap-sam-export_aggregated\runs\2026-03-26_11-38-22__BPMN_SystemPrompt agent_evaluation\evaluation_config.json
 */
function parseArgs(argv: string[]): Args {
  if (argv.length < 2) {
    throw new Error(
      "Usage: npx tsx agent_evaluation/evaluate_run.ts <runDir> <evaluation_config.json>"
    );
  }

  return {
    runDir: argv[0],
    evaluationConfigPath: argv[1],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await evaluateRun(args);
}

const isMain = pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  main().catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
}