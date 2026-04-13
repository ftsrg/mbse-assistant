import fs from "node:fs/promises";
import path from "node:path";

type RunMeta = {
  inputs?: {
    questionsFile?: string;
    endpointUrl?: string;
  };
  llm?: {
    model?: string;
  };
};

type QuestionSetRule = {
  questionSetId: string;
  expectedAnswersFile: string;
  expectedKeywordsFile?: string;
  modelElementIDsFile?: string;
  datasetKind?: string;
};

type DatasetRule = {
  match: {
    endpointUrlContains: string;
  };
  datasetName: string;
  datasetKind?: string;
};

type EvaluationConfig = {
  version: number;
  questionSets: Record<string, QuestionSetRule>;
  datasets: DatasetRule[];
};

export type ResolvedEvaluationContext = {
  datasetName: string;
  datasetKind: string;
  questionSetId: string;
  questionsFile: string;
  expectedAnswersFile: string;
  expectedKeywordsFile?: string;
  modelElementIDsFile?: string;
  modelName: string;
  endpointUrl: string;
};

export async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

/**
 * Normalize a repo-relative path into forward-slash form.
 * This keeps matching stable across Windows and Linux.
 */
export function normalizeRelPath(p: string): string {
  return String(p ?? "").replaceAll("\\", "/").trim();
}

/**
 * Resolve a relative or absolute path against the directory
 * that contains the evaluation config file.
 */
export function resolveFromConfigDir(configPath: string, relOrAbs: string): string {
  const raw = String(relOrAbs ?? "").trim();
  if (!raw) return raw;
  if (path.isAbsolute(raw)) return path.normalize(raw);
  return path.resolve(path.dirname(configPath), raw);
}

/**
 * Find exactly one matching dataset rule for a given endpoint URL.
 * Throw an error if there is no match or more than one match.
 */
function matchDatasetRule(endpointUrl: string, datasets: DatasetRule[]): DatasetRule {
  const matches = datasets.filter((d) =>
    endpointUrl.includes(String(d?.match?.endpointUrlContains ?? ""))
  );

  if (matches.length === 0) {
    throw new Error(
      `No dataset rule matched endpointUrl='${endpointUrl}'.`
    );
  }

  if (matches.length > 1) {
    const patterns = matches.map((m) => m.match.endpointUrlContains).join(", ");
    throw new Error(
      `Multiple dataset rules matched endpointUrl='${endpointUrl}': ${patterns}`
    );
  }

  return matches[0];
}

/**
 * Resolve the full evaluation context from:
 * - an existing run.meta.json
 * - the external evaluation_config.json
 *
 * This function does not infer anything heuristically unless the config
 * itself explicitly provides a fallback path.
 */
export async function resolveEvaluationContext(opts: {
  runMetaPath: string;
  configPath: string;
}): Promise<ResolvedEvaluationContext> {
  const runMeta = await readJson<RunMeta>(opts.runMetaPath);
  const cfg = await readJson<EvaluationConfig>(opts.configPath);

  const questionsFile = normalizeRelPath(runMeta?.inputs?.questionsFile ?? "");
  const endpointUrl = String(runMeta?.inputs?.endpointUrl ?? "").trim();
  const modelName = String(runMeta?.llm?.model ?? "").trim();

  if (!questionsFile) {
    throw new Error(
      `run.meta.json is missing inputs.questionsFile: ${opts.runMetaPath}`
    );
  }

  if (!endpointUrl) {
    throw new Error(
      `run.meta.json is missing inputs.endpointUrl: ${opts.runMetaPath}`
    );
  }

  if (!modelName) {
    throw new Error(
      `run.meta.json is missing llm.model: ${opts.runMetaPath}`
    );
  }

  const qs = cfg.questionSets?.[questionsFile];
  if (!qs) {
    const known = Object.keys(cfg.questionSets ?? {}).sort().join(", ");
    throw new Error(
      `No questionSet rule found for questionsFile='${questionsFile}'. Known keys: ${known}`
    );
  }

  const ds = matchDatasetRule(endpointUrl, cfg.datasets ?? []);

  const datasetKind = String(qs.datasetKind ?? ds.datasetKind ?? "").trim();
  if (!datasetKind) {
    throw new Error(
      `datasetKind could not be resolved for questionsFile='${questionsFile}' and endpointUrl='${endpointUrl}'`
    );
  }

  return {
    datasetName: ds.datasetName,
    datasetKind,
    questionSetId: qs.questionSetId,
    questionsFile,
    expectedAnswersFile: normalizeRelPath(qs.expectedAnswersFile),
    expectedKeywordsFile: qs.expectedKeywordsFile
      ? normalizeRelPath(qs.expectedKeywordsFile)
      : undefined,
    modelElementIDsFile: qs.modelElementIDsFile
      ? normalizeRelPath(qs.modelElementIDsFile)
      : undefined,
    modelName,
    endpointUrl,
  };
}

/**
 * Convert the resolved relative file paths into absolute paths.
 * This is useful for the evaluator when opening expected answer files.
 */
export function materializeResolvedPaths(
  configPath: string,
  resolved: ResolvedEvaluationContext
) {
  return {
    ...resolved,
    expectedAnswersFileAbs: resolveFromConfigDir(configPath, resolved.expectedAnswersFile),
    expectedKeywordsFileAbs: resolved.expectedKeywordsFile
      ? resolveFromConfigDir(configPath, resolved.expectedKeywordsFile)
      : undefined,
    modelElementURIsFileAbs: resolved.modelElementIDsFile
      ? resolveFromConfigDir(configPath, resolved.modelElementIDsFile)
      : undefined,
  };
}