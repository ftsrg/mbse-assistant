import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Metric, MetricInput, MetricScore } from "./metric_types";

/**
 * Model Element URI Recall Metric (v2)
 * ====================================
 *
 * Changes compared to the previous version:
 * 1. Simplified recovery heuristic:
 *    - collect rewrite-driving variables from the SELECT clause
 *    - plain top-level SELECT variables are kept as-is
 *    - for `(COUNT(... ) AS ?alias)` expressions, the alias is ignored during
 *      SELECT reconstruction and the variable(s) inside COUNT(...) are used instead
 *    - for each collected variable, look for triple patterns where it appears
 *      in object position: `?s ?p ?o`
 *    - if such matches exist, put the corresponding subject variable(s) into
 *      the rewritten SELECT
 *    - if a variable came from inside COUNT(...) and no matching subject
 *      variable is found, keep the original COUNT-derived variable in the
 *      rewritten SELECT
 *    - if GROUP BY exists, rebuild it from all variables that appear in the
 *      rewritten SELECT
 *    - if ORDER BY exists, rewrite each referenced original variable or
 *      aggregate alias to the derived rewritten variable for that item
 *    - no hierarchy fallback is used
 * 2. We do NOT append LIMIT 20 to the query.
 *    We only process the first 20 rows from the returned
 *    SPARQL JSON `results.bindings` array.
 * 3. Error behavior is configurable:
 *    - onError: "zero"  -> metric returns value 0
 *    - onError: "throw" -> metric returns value null + error string
 */

// ---------------------------------------------------------------------------
// Filesystem roots and reusable caches
// ---------------------------------------------------------------------------

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, "..");
const AUTOMATED_RESULTS_ROOT = path.join(REPO_ROOT, "automated_test_results");

const runDirCache = new Map<string, string>();
const runMetaCache = new Map<string, any>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RunMeta = {
  inputs?: {
    endpointUrl?: string;
  };
  output?: {
    questionsDir?: string;
  };
};

type QueryRecord = {
  questionId: string;
  sourceFile: string;
  seq: number;
  rawQuery: string;
  prettyQuery: string;
};

type RecoveryPlan = {
  originalSelectVars: string[];
  mappedSubjectsByOriginalVar: Map<string, string[]>;
  primaryReplacementByOriginalVar: Map<string, string>;
  rewrittenSelectVars: string[];

  // New: maps ORDER BY-referenced original variables or aggregate aliases
  // to the rewritten variable that should be used in the recovery query.
  orderByReplacementByOriginalVar: Map<string, string>;
};

type RecoveryBuildResult = {
  changedQuery: string;
  plan: RecoveryPlan;
};

type MetricOptions = {
  onError?: "zero" | "throw";
  maxRows?: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard cap for how many SPARQL result rows are taken into account by the metric.
 *
 * Important:
 * - We do NOT rewrite the query by appending a LIMIT clause.
 * - We only truncate the returned `results.bindings` array in memory.
 */
const DEFAULT_MAX_ROWS = 20;

/**
 * Plain-text debug log written next to this metric file.
 *
 * The file is appended to, so multiple evaluation runs can be inspected later.
 */
const URI_RECALL_LOG_ENABLED = false;
const URI_RECALL_LOG_PATH = path.join(THIS_DIR, "uri_recall_metric_log.txt");

const BBO_EXTENSION_CLASS_URI_RE =
  /^http:\/\/www\.onto-bpo\.eu\/ontologies\/bboExtension#[A-Za-z0-9_]+$/;

const KEYWORDS_TOPLEVEL = [
  "PREFIX",
  "BASE",
  "SELECT",
  "CONSTRUCT",
  "ASK",
  "DESCRIBE",
  "WHERE",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "VALUES",
] as const;

const VAR_NAME_TAIL_RE = /[A-Za-z0-9_]/;

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

/**
 * Small typed error used to preserve a machine-friendly error code together with
 * a readable message. This lets the metric distinguish between, for example,
 * network failures, syntax problems, and local rewrite issues.
 */
class MetricExecutionError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MetricExecutionError";
    this.code = code;
  }
}

function stringifyError(e: unknown): string {
  if (e instanceof MetricExecutionError) {
    return `${e.code}: ${e.message}`;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

function classifyHttpError(status: number, payload: string): MetricExecutionError {
  const short = payload.replace(/\s+/g, " ").trim().slice(0, 1200);
  if (status === 400 && /syntax|parse|lexical|QueryParseException|Encountered/i.test(payload)) {
    return new MetricExecutionError("sparql_syntax_error", `HTTP ${status}. ${short}`);
  }
  return new MetricExecutionError("http_error", `HTTP ${status}. ${short}`);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort existence check that never throws.
 */
async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse a UTF-8 JSON file.
 */
async function readJson<T = any>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

/**
 * Return the sorted contents of a string set.
 */
function sortedValues(set: Set<string>): string[] {
  return [...set].sort();
}

/**
 * Remove duplicates while preserving the first-seen order.
 */
function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Run directory and metadata resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the on-disk run directory from a runId.
 *
 * Expected layout:
 *   automated_test_results/<dataset>/runs/<runId>/run.meta.json
 *
 * The dataset name is not inferred from the runId itself. Instead, all dataset
 * folders are scanned until a matching run directory is found.
 */
async function resolveRunDirFromRunId(runId: string): Promise<string> {
  const cached = runDirCache.get(runId);
  if (cached) return cached;

  const datasets = await fs.readdir(AUTOMATED_RESULTS_ROOT, { withFileTypes: true });

  for (const ds of datasets) {
    if (!ds.isDirectory()) continue;
    if (ds.name.startsWith("_")) continue;

    const candidate = path.join(AUTOMATED_RESULTS_ROOT, ds.name, "runs", runId);
    const metaPath = path.join(candidate, "run.meta.json");

    if (await exists(metaPath)) {
      runDirCache.set(runId, candidate);
      return candidate;
    }
  }

  throw new MetricExecutionError("run_not_found", `Run directory could not be resolved for runId='${runId}'.`);
}

/**
 * Load and cache the `run.meta.json` file for a benchmark run.
 */
async function loadRunMeta(runDir: string): Promise<RunMeta> {
  const metaPath = path.join(runDir, "run.meta.json");
  const cached = runMetaCache.get(metaPath);
  if (cached) return cached as RunMeta;

  const runMeta = await readJson<RunMeta>(metaPath);
  runMetaCache.set(metaPath, runMeta);
  return runMeta;
}

/**
 * Resolve the qNNN trace JSON path for a single benchmark question.
 */
function resolveQuestionTracePath(runDir: string, runMeta: RunMeta, questionId: string): string {
  const questionsDirName = String(runMeta?.output?.questionsDir ?? "questions").trim() || "questions";
  return path.join(runDir, questionsDirName, `${questionId}.json`);
}

// ---------------------------------------------------------------------------
// Query extraction from the question trace
// ---------------------------------------------------------------------------

/**
 * Remove one surrounding pair of double quotes if the entire string is quoted.
 */
function stripOuterQuotes(text: string): string {
  const s = text.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Decode the most common escaped forms seen in JSON-stored query strings.
 */
function decodeEscapesIfNeeded(text: string): string {
  let s = stripOuterQuotes(text);
  if (s.includes("\\n") || s.includes("\\t") || s.includes('\\"')) {
    s = s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
  }
  return s;
}

/**
 * Apply a lightweight formatting pass to a SPARQL query.
 *
 * This is intentionally not a full SPARQL parser. The goal is simply to make
 * logged and re-executed queries easier to inspect while preserving the
 * semantic structure and the original PREFIX / BASE block.
 */
export function prettySparql(rawQuery: string): string {
  let query = decodeEscapesIfNeeded(rawQuery).trim();
  query = query.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if ((query.match(/\n/g) ?? []).length <= 1) {
    for (const kw of [...KEYWORDS_TOPLEVEL].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`\\s*${kw.replace(/ /g, "\\s+")}\\s+`, "ig");
      query = query.replace(re, `\n${kw} `);
    }
    query = query.trim();
  }

  const rawLines = query
    .split("\n")
    .map((ln) => ln.replace(/\s+$/g, ""))
    .filter((ln) => ln.trim().length > 0);

  const out: string[] = [];
  let indent = 0;

  const canonPrefixOrBase = (line: string): string => {
    const trimmed = line.trim();
    const m = /^(prefix|base)\s+/i.exec(trimmed);
    if (!m) return trimmed;
    return `${m[1].toUpperCase()} ${trimmed.slice(m[0].length).trim()}`;
  };

  for (const raw of rawLines) {
    const line = canonPrefixOrBase(raw);
    const stripped = line.trim();
    const upper = stripped.toUpperCase();

    if (upper.startsWith("PREFIX ") || upper.startsWith("BASE ")) {
      out.push(stripped);
      continue;
    }

    if (stripped === "}") {
      indent = Math.max(indent - 1, 0);
      out.push(`${"  ".repeat(indent)}${stripped}`);
      continue;
    }

    if (
      upper.startsWith("SELECT") ||
      upper.startsWith("ASK") ||
      upper.startsWith("CONSTRUCT") ||
      upper.startsWith("DESCRIBE") ||
      upper.startsWith("WHERE") ||
      upper.startsWith("GROUP BY") ||
      upper.startsWith("ORDER BY") ||
      upper.startsWith("HAVING") ||
      upper.startsWith("LIMIT") ||
      upper.startsWith("OFFSET")
    ) {
      out.push(stripped);
      if (stripped.endsWith("{")) indent += 1;
      continue;
    }

    if (stripped === "{" || stripped.endsWith("{")) {
      out.push(`${"  ".repeat(indent)}${stripped}`);
      indent += 1;
      continue;
    }

    if (
      upper.startsWith("FILTER") ||
      upper.startsWith("OPTIONAL") ||
      upper.startsWith("UNION") ||
      upper.startsWith("BIND") ||
      upper.startsWith("VALUES")
    ) {
      out.push(`${"  ".repeat(indent)}${stripped}`);
      if (stripped.endsWith("{")) indent += 1;
      continue;
    }

    out.push(`${"  ".repeat(indent)}${stripped}`);
    if (stripped.endsWith("{")) indent += 1;
  }

  const prefixLines = out.filter((ln) => /^PREFIX\s|^BASE\s/i.test(ln));
  const restLines = out.filter((ln) => !/^PREFIX\s|^BASE\s/i.test(ln));

  if (prefixLines.length > 0) {
    return `${prefixLines.join("\n")}\n\n${restLines.join("\n").trim()}\n`;
  }

  return `${restLines.join("\n").trim()}\n`;
}

/**
 * Extract the last query-bearing event from a question trace.
 *
 * The benchmark trace may contain several tool calls. We keep the query from
 * the event with the highest `seq` value because that corresponds to the final
 * SPARQL query actually executed by the agent.
 */
function extractLastQueryFromTrace(traceObj: any, sourceFile: string): QueryRecord | null {
  const questionId = String(traceObj?.meta?.questionId ?? path.basename(sourceFile, ".json"));
  const events = Array.isArray(traceObj?.conversation?.events) ? traceObj.conversation.events : [];

  let bestSeq = -1;
  let bestQuery: string | null = null;

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const request = event.request;
    if (!request || typeof request !== "object") continue;
    if (typeof request.query !== "string") continue;

    const seq = Number.isFinite(event.seq) ? Number(event.seq) : -1;
    if (seq > bestSeq) {
      bestSeq = seq;
      bestQuery = request.query;
    }
  }

  if (!bestQuery) return null;

  return {
    questionId,
    sourceFile,
    seq: bestSeq,
    rawQuery: bestQuery,
    prettyQuery: prettySparql(bestQuery),
  };
}

// ---------------------------------------------------------------------------
// SPARQL execution and URI extraction
// ---------------------------------------------------------------------------

/**
 * Execute a SPARQL query against the configured endpoint.
 *
 * Error handling policy:
 * - network failures -> `network_error`
 * - HTTP failures    -> classified, with syntax errors separated when possible
 * - invalid JSON     -> `parse_error`
 */
async function executeSparqlOrThrow(endpoint: string, query: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${endpoint}?query=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/sparql-results+json" },
    });
  } catch (e: any) {
    throw new MetricExecutionError("network_error", String(e?.message ?? e));
  }

  const payload = await res.text();

  if (!res.ok) {
    throw classifyHttpError(res.status, payload);
  }

  try {
    return JSON.parse(payload);
  } catch (e: any) {
    throw new MetricExecutionError(
      "parse_error",
      `${String(e?.message ?? e)} | payload=${payload.slice(0, 1200)}`
    );
  }
}

/**
 * Collect URI-valued bindings from the first `maxRows` SPARQL result rows.
 *
 * Important:
 * - only the first N rows are processed
 * - ontology-class URIs from the bboExtension namespace are excluded
 * - the output is a set, because the metric is set-based recall
 */
function collectModelElementUrisFromSparqlResult(result: any, maxRows: number): Set<string> {
  const out = new Set<string>();
  const bindings = Array.isArray(result?.results?.bindings)
    ? result.results.bindings.slice(0, maxRows)
    : [];

  for (const row of bindings) {
    if (!row || typeof row !== "object") continue;

    for (const cell of Object.values(row)) {
      if (!cell || typeof cell !== "object") continue;
      if ((cell as any).type !== "uri") continue;

      const value = typeof (cell as any).value === "string" ? (cell as any).value.trim() : "";
      if (!value) continue;
      if (BBO_EXTENSION_CLASS_URI_RE.test(value)) continue;

      out.add(value);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
//Logging helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Debug logging
// ---------------------------------------------------------------------------

/**
 * Convert one SPARQL JSON binding cell into a compact printable string.
 */
function bindingCellToString(cell: any): string {
  if (!cell || typeof cell !== "object") return "";

  const value = typeof cell.value === "string" ? cell.value : String(cell.value ?? "");
  const lang = typeof cell["xml:lang"] === "string" ? `@${cell["xml:lang"]}` : "";
  const datatype = typeof cell.datatype === "string" ? `^^${cell.datatype}` : "";

  if (cell.type === "uri") return value;
  if (cell.type === "bnode") return `_:${value}`;
  return `${value}${lang}${datatype}`;
}

/**
 * Format the first `maxRows` rows of a SPARQL JSON result as a simple text table.
 *
 * Important:
 * - this mirrors the metric behavior: only the first `maxRows` rows are shown
 * - no LIMIT is injected into the query itself
 */
function formatSparqlResultTable(result: any, maxRows: number): string {
  if (typeof result?.boolean === "boolean") {
    return `ASK result: ${result.boolean ? "true" : "false"}`;
  }

  const vars: string[] = Array.isArray(result?.head?.vars) ? result.head.vars.map(String) : [];
  const allBindings: any[] = Array.isArray(result?.results?.bindings) ? result.results.bindings : [];
  const bindings = allBindings.slice(0, maxRows);

  if (vars.length === 0) {
    return "(no columns)";
  }

  if (bindings.length === 0) {
    return "(empty result set)";
  }

  const rows: string[][] = bindings.map((binding) =>
    vars.map((v) => bindingCellToString(binding?.[v]))
  );

  const widths = vars.map((v, colIdx) => {
    const cellMax = Math.max(...rows.map((row) => row[colIdx]?.length ?? 0));
    return Math.max(v.length, cellMax);
  });

  const formatRow = (cells: string[]) =>
    `| ${cells.map((c, i) => c.padEnd(widths[i], " ")).join(" | ")} |`;

  const header = formatRow(vars);
  const separator = `|-${widths.map((w) => "-".repeat(w)).join("-|-")}-|`;
  const body = rows.map((row) => formatRow(row));

  const lines = [header, separator, ...body];

  if (allBindings.length > bindings.length) {
    lines.push("");
    lines.push(`(truncated to first ${maxRows} rows, full rowCount=${allBindings.length})`);
  } else {
    lines.push("");
    lines.push(`(rowCount=${allBindings.length})`);
  }

  return lines.join("\n");
}

type UriRecallLogParams = {
  questionId: string;
  originalQuery?: string;
  originalResult?: any;
  changedQuery?: string;
  changedResult?: any;
  maxRows: number;
  error?: string;
};

/**
 * Append one human-readable log block for a single benchmark question.
 */
async function appendUriRecallLog(params: UriRecallLogParams): Promise<void> {

  if (!URI_RECALL_LOG_ENABLED) return;

  const parts: string[] = [];

  parts.push(`=== ${params.questionId} ===`);

  if (params.originalQuery) {
    parts.push("original query:");
    parts.push(params.originalQuery.trim());
    parts.push("");
  }

  parts.push("original query results:");
  if (params.originalResult !== undefined) {
    parts.push(formatSparqlResultTable(params.originalResult, params.maxRows));
  } else {
    parts.push("(not available)");
  }
  parts.push("");

  if (params.changedQuery) {
    parts.push("changed query:");
    parts.push(params.changedQuery.trim());
    parts.push("");

    parts.push("changed query results:");
    if (params.changedResult !== undefined) {
      parts.push(formatSparqlResultTable(params.changedResult, params.maxRows));
    } else {
      parts.push("(not available)");
    }
    parts.push("");
  }

  if (params.error) {
    parts.push("error:");
    parts.push(params.error);
    parts.push("");
  }

  await fs.appendFile(URI_RECALL_LOG_PATH, `${parts.join("\n")}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Query parsing and rewrite heuristic
// ---------------------------------------------------------------------------

/**
 * Split a query into:
 * - the PREFIX / BASE section
 * - the remainder starting from SELECT / ASK / CONSTRUCT / DESCRIBE
 */
function splitQuerySections(query: string): { prefixes: string; remainder: string } {
  const m = /\b(SELECT|ASK|CONSTRUCT|DESCRIBE)\b/i.exec(query);
  if (!m || typeof m.index !== "number") {
    return { prefixes: "", remainder: query };
  }

  return {
    prefixes: query.slice(0, m.index).trimEnd(),
    remainder: query.slice(m.index).trimStart(),
  };
}

/**
 * Locate the outer WHERE { ... } block using brace balancing and return both
 * the inner body and the character offsets of the surrounding braces.
 */
function extractWhereBlockRange(query: string): { body: string; braceStart: number; braceEnd: number } | null {
  const m = /\bWHERE\s*\{/i.exec(query);
  if (!m || typeof m.index !== "number") return null;

  const braceStart = query.indexOf("{", m.index);
  if (braceStart < 0) return null;

  let depth = 0;
  for (let i = braceStart; i < query.length; i++) {
    const ch = query[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          body: query.slice(braceStart + 1, i).trim(),
          braceStart,
          braceEnd: i,
        };
      }
    }
  }

  return null;
}

/**
 * Parse the top-level SELECT header and return:
 * - preserved PREFIX / BASE block
 * - SELECT modifier (`DISTINCT` / `REDUCED`, if present)
 * - raw SELECT variable section before WHERE
 */
function extractSelectHeader(query: string): { prefixes: string; modifier: string; selectText: string } | null {
  const { prefixes, remainder } = splitQuerySections(query);
  const m = /^SELECT\s+(DISTINCT\s+|REDUCED\s+)?([\s\S]*?)\bWHERE\b/i.exec(remainder);
  if (!m) return null;

  return {
    prefixes,
    modifier: (m[1] ?? "").trim(),
    selectText: m[2] ?? "",
  };
}

/**
 * Remove parenthesized expressions from a text block.
 *
 * This helper is used after aggregate expressions such as
 * `(COUNT(...) AS ?alias)` have already been handled separately.
 * The remaining text can then be scanned for plain top-level SELECT variables
 * without accidentally picking up variables from other nested expressions.
 */
function removeParenthesizedExpressions(text: string): string {
  let depth = 0;
  let out = "";

  for (const ch of text) {
    if (ch === "(") {
      depth += 1;
      continue;
    }

    if (ch === ")") {
      depth = Math.max(depth - 1, 0);
      continue;
    }

    if (depth === 0) {
      out += ch;
    }
  }

  return out;
}

/**
 * One rewrite-driving variable extracted from the SELECT clause.
 *
 * `source` tells whether the variable came from:
 * - a plain top-level SELECT variable, or
 * - the inside of a COUNT(...) aggregate expression
 *
 * If the variable came from COUNT(... AS ?alias), `aliasVarName` stores the
 * original aggregate alias so ORDER BY can later be rewritten consistently.
 */
type SelectVarInfo = {
  varName: string;
  source: "plain" | "count";

  // Present only for COUNT(... AS ?alias)
  aliasVarName?: string;
};


/**
 * Extract rewrite-driving variables from the SELECT clause together with their source.
 *
 * Rules:
 * - plain top-level SELECT variables are returned with `source: "plain"`
 * - for `(COUNT(... ) AS ?alias)` expressions, the alias itself is not used as
 *   a rewritten SELECT variable
 * - instead, the variable(s) appearing inside COUNT(...) are returned with
 *   `source: "count"`
 * - when present, the COUNT alias is remembered in `aliasVarName` so ORDER BY
 *   clauses such as `ORDER BY ?taskCount` can later be mapped to the rewritten
 *   variable derived from the COUNT input
 * - duplicates are removed while preserving first-seen order
 *
 * Examples:
 *   SELECT ?model ?task WHERE { ... }
 *   -> [{ varName: "?model", source: "plain" },
 *       { varName: "?task",  source: "plain" }]
 *
 *   SELECT (COUNT(?startEvent) AS ?startEventCount) WHERE { ... }
 *   -> [{ varName: "?startEvent", source: "count", aliasVarName: "?startEventCount" }]
 *
 *   SELECT ?model (COUNT(DISTINCT ?task) AS ?taskCount) WHERE { ... }
 *   -> [{ varName: "?model", source: "plain" },
 *       { varName: "?task",  source: "count", aliasVarName: "?taskCount" }]
 */
function extractSelectVariablesWithSource(query: string): SelectVarInfo[] {
  const header = extractSelectHeader(query);
  if (!header) return [];

  const selectText = header.selectText;
  const out: SelectVarInfo[] = [];

  const countAsRe =
  /\(\s*COUNT\s*\(([\s\S]*?)\)\s+AS\s+(\?[A-Za-z_][A-Za-z0-9_]*)\s*\)/gi;

  let remainder = selectText.replace(countAsRe, (_full, countInner, aliasVar) => {
    const innerVars = String(countInner).match(/\?[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    for (const v of innerVars) {
      out.push({
        varName: v,
        source: "count",
        aliasVarName: String(aliasVar),
      });
    }
    return " ";
  });

  remainder = removeParenthesizedExpressions(remainder);

  const plainVars = remainder.match(/\?[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const v of plainVars) {
    out.push({ varName: v, source: "plain" });
  }

  // unique by varName, preserving first occurrence
  const seen = new Set<string>();
  return out.filter((x) => {
    if (seen.has(x.varName)) return false;
    seen.add(x.varName);
    return true;
  });
}


/**
 * Escape text for safe use inside a regular expression.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * For one rewrite-driving variable, find every triple pattern where that
 * variable appears in object position and collect the corresponding subject
 * variable.
 *
 * Target pattern:
 *   ?subject ?predicate ?object .
 *
 * If the supplied variable is found as `?object`, the function returns the
 * matching `?subject` variable(s).
 *
 * This is applied equally to:
 * - plain SELECT variables, and
 * - variables extracted from inside COUNT(...) expressions.
 */
function findSubjectVarsForObject(whereBody: string, objectVar: string): string[] {
  const escapedVar = escapeRegex(objectVar);
  const re = new RegExp(
    `(?<subject>\\?[A-Za-z_][A-Za-z0-9_]*)\\s+[^\\s]+\\s+${escapedVar}\\s*\\.`,
    "gi"
  );

  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(whereBody)) !== null) {
    const subject = m.groups?.subject;
    if (!subject) continue;
    out.push(subject);
  }

  return uniquePreserveOrder(out);
}

/**
 * Build the rewrite plan for the simplified recovery heuristic.
 *
 * The plan is built from rewrite-driving SELECT variables, which may come from:
 * - plain top-level SELECT variables, or
 * - inside COUNT(...) aggregate expressions
 *
 * For each collected variable:
 * - look for `?s ?p ?o` triple patterns where the variable appears as `?o`
 * - if such matches exist, remember all matching subject variables
 * - add those subject variables to the rewritten SELECT
 * - use the first matched subject variable as the primary replacement for
 *   later clause rewriting
 * - if the variable came from COUNT(...) and no matching subject variable
 *   exists, keep the original COUNT-derived variable in the rewritten SELECT
 *
 * The recovery plan therefore serves two purposes:
 * - it determines the rewritten SELECT variable list
 * - it records how original variables and COUNT aliases should be rewritten in
 *   GROUP BY / ORDER BY clauses
 */
function buildRecoveryPlan(originalQuery: string, whereBody: string): RecoveryPlan {
  const selectVars = extractSelectVariablesWithSource(originalQuery);

  const originalSelectVars = selectVars.map((x) => x.varName);
  const mappedSubjectsByOriginalVar = new Map<string, string[]>();
  const primaryReplacementByOriginalVar = new Map<string, string>();
  const orderByReplacementByOriginalVar = new Map<string, string>();
  const rewrittenSelectVars: string[] = [];

  for (const selectVar of selectVars) {
      const originalVar = selectVar.varName;
      const subjects = findSubjectVarsForObject(whereBody, originalVar);

      if (subjects.length > 0) {
        mappedSubjectsByOriginalVar.set(originalVar, subjects);
        primaryReplacementByOriginalVar.set(originalVar, subjects[0]);
        rewrittenSelectVars.push(...subjects);

        // ORDER BY should use the derived rewritten variable.
        orderByReplacementByOriginalVar.set(originalVar, subjects[0]);

        // If this came from COUNT(... AS ?alias), the alias should also point
        // to the first derived rewritten variable.
        if (selectVar.aliasVarName) {
          orderByReplacementByOriginalVar.set(selectVar.aliasVarName, subjects[0]);
        }

        continue;
      }

      if (selectVar.source === "count") {
        rewrittenSelectVars.push(originalVar);

        // COUNT-derived variable without ?s backtrace falls back to itself.
        orderByReplacementByOriginalVar.set(originalVar, originalVar);

        if (selectVar.aliasVarName) {
          orderByReplacementByOriginalVar.set(selectVar.aliasVarName, originalVar);
        }
      } else {
        // Plain variable without ?s backtrace: ORDER BY should still fall back
        // to the original variable if it appears there.
        orderByReplacementByOriginalVar.set(originalVar, originalVar);
      }
  }

  return {
    originalSelectVars,
    mappedSubjectsByOriginalVar,
    primaryReplacementByOriginalVar,
    rewrittenSelectVars: uniquePreserveOrder(rewrittenSelectVars),
    orderByReplacementByOriginalVar,
  };
}


/**
 * Replace variable names in a clause while avoiding accidental partial matches.
 *
 * Example:
 * - replace `?x`
 * - do not accidentally touch `?x1`
 */
function replaceVariablesInText(text: string, replacements: Map<string, string>): string {
  if (replacements.size === 0) return text;

  const keys = [...replacements.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
  const re = new RegExp(`(${keys.join("|")})(?![A-Za-z0-9_])`, "g");

  return text.replace(re, (match: string, variable: string, offset: number, source: string) => {
    const prev = offset > 0 ? source[offset - 1] : "";
    if (prev && VAR_NAME_TAIL_RE.test(prev)) {
      return match;
    }
    return replacements.get(variable) ?? match;
  });
}

/**
 * Rewrite post-WHERE clauses for the recovery query.
 *
 * Rules:
 * - GROUP BY is rebuilt from all variables that appear in the rewritten SELECT
 * - ORDER BY variables are rewritten through the derived replacement mapping
 *   for original variables and aggregate aliases
 * - HAVING, LIMIT, and OFFSET are preserved as-is
 *
 * This is intentionally not a semantic preservation step for aggregates.
 * The goal of the recovery query is to expose model-element-bearing variables,
 * not to preserve the original aggregated result shape exactly.
 */
function rewriteAfterWhereClauses(
  afterWhere: string,
  rewrittenSelectVars: string[],
  orderByReplacements: Map<string, string>
): string {
  if (!afterWhere.trim()) return "";

  const clauseStartRe = /\b(GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET)\b/gi;
  const matches = [...afterWhere.matchAll(clauseStartRe)];
  if (matches.length === 0) return afterWhere.trim();

  const chunks: string[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? afterWhere.length) : afterWhere.length;
    const clauseText = afterWhere.slice(start, end).trim();
    const clauseType = match[1].toUpperCase().replace(/\s+/g, " ");

    if (clauseType === "GROUP BY") {
      chunks.push(`GROUP BY ${rewrittenSelectVars.join(" ")}`);
      continue;
    }

    if (clauseType === "ORDER BY") {
      chunks.push(replaceVariablesInText(clauseText, orderByReplacements));
      continue;
    }

    chunks.push(clauseText);
  }

  return chunks.join("\n").trim();
}

/**
 * Build the rewritten recovery query.
 *
 * Rewriting rules:
 * - the SELECT clause is rebuilt from the recovery plan
 * - variables that can be backtraced through `?s ?p ?o` are replaced by their
 *   mapped subject variables
 * - COUNT-derived variables that cannot be backtraced are kept as-is
 * - the WHERE body remains unchanged
 * - if GROUP BY exists, it is rebuilt from all variables that appear in the
 *   rewritten SELECT
 * - if ORDER BY exists, each referenced original variable or COUNT alias is
 *   replaced by its derived rewritten variable
 * - no hierarchy fallback is used
 * - existing LIMIT / OFFSET are preserved exactly as they are
 */
function buildRecoveryQuery(originalQuery: string): RecoveryBuildResult {
  const header = extractSelectHeader(originalQuery);
  if (!header) {
    throw new MetricExecutionError("rewrite_error", "Only SELECT queries can be rewritten by this heuristic.");
  }

  const whereBlock = extractWhereBlockRange(originalQuery);
  if (!whereBlock) {
    throw new MetricExecutionError("rewrite_error", "Could not extract WHERE block from the original query.");
  }

  const plan = buildRecoveryPlan(originalQuery, whereBlock.body);
  if (plan.rewrittenSelectVars.length === 0) {
  throw new MetricExecutionError(
    "rewrite_error",
    [
      "The heuristic produced no rewritten SELECT variables.",
      `originalSelectVars=${JSON.stringify(plan.originalSelectVars)}`,
      `mappedSubjectsByOriginalVar=${JSON.stringify(Object.fromEntries(
        [...plan.mappedSubjectsByOriginalVar.entries()]
      ))}`,
      `primaryReplacementByOriginalVar=${JSON.stringify(Object.fromEntries(
        [...plan.primaryReplacementByOriginalVar.entries()]
      ))}`,
    ].join(" | ")
  );
}

  const afterWhere = originalQuery.slice(whereBlock.braceEnd + 1).trim();
  const rewrittenAfterWhere = rewriteAfterWhereClauses(
    afterWhere,
    plan.rewrittenSelectVars,
    plan.orderByReplacementByOriginalVar
  );  
  const selectModifier = header.modifier ? `${header.modifier} ` : "";

  const parts: string[] = [];
  if (header.prefixes.trim()) {
    parts.push(header.prefixes.trim());
    parts.push("");
  }
  parts.push(`SELECT ${selectModifier}${plan.rewrittenSelectVars.join(" ")} WHERE {`);
  parts.push(whereBlock.body);
  parts.push("}");
  if (rewrittenAfterWhere) {
    parts.push(rewrittenAfterWhere);
  }

  return {
    changedQuery: `${parts.join("\n").trim()}\n`,
    plan,
  };
}

// ---------------------------------------------------------------------------
// Actual URI extraction workflow
// ---------------------------------------------------------------------------

/**
 * Resolve the actual URI set touched by the benchmark run for one question.
 *
 * Workflow:
 * 1. load the question trace
 * 2. extract the final executed SPARQL query
 * 3. execute the original query and collect URIs from the first `maxRows` rows
 * 4. if nothing useful is found, build and run the rewritten query
 * 5. return the resulting URI set together with debug details
 */
async function resolveActualUriSet(
  runDir: string,
  runMeta: RunMeta,
  questionId: string,
  options: Required<MetricOptions>
): Promise<{ actualSet: Set<string>; details: Record<string, any> }> {
  const tracePath = resolveQuestionTracePath(runDir, runMeta, questionId);
  const traceObj = await readJson<any>(tracePath);
  const extracted = extractLastQueryFromTrace(traceObj, tracePath);

  if (!extracted) {
    throw new MetricExecutionError("missing_query", `No SPARQL query found in question trace for questionId='${questionId}'.`);
  }

  const endpointUrl = String(runMeta?.inputs?.endpointUrl ?? "").trim();
  if (!endpointUrl) {
    throw new MetricExecutionError("missing_endpoint", "run.meta.json is missing inputs.endpointUrl.");
  }

  let originalQueryForLog = extracted.prettyQuery;
  let originalResultForLog: any = undefined;
  let changedQueryForLog: string | undefined = undefined;
  let changedResultForLog: any = undefined;

  try {
    const originalResult = await executeSparqlOrThrow(endpointUrl, extracted.prettyQuery);
    originalResultForLog = originalResult;

    const originalUris = collectModelElementUrisFromSparqlResult(originalResult, options.maxRows);
    if (originalUris.size > 0) {
      await appendUriRecallLog({
        questionId,
        originalQuery: originalQueryForLog,
        originalResult: originalResultForLog,
        maxRows: options.maxRows,
      });

      return {
        actualSet: originalUris,
        details: {
          rowLimit: options.maxRows,
          recoveryUsed: false,
          actualCount: originalUris.size,
        },
      };
    }

    const { changedQuery, plan } = buildRecoveryQuery(extracted.prettyQuery);
    changedQueryForLog = changedQuery;

    const changedResult = await executeSparqlOrThrow(endpointUrl, changedQuery);
    changedResultForLog = changedResult;

    const changedUris = collectModelElementUrisFromSparqlResult(changedResult, options.maxRows);

    await appendUriRecallLog({
      questionId,
      originalQuery: originalQueryForLog,
      originalResult: originalResultForLog,
      changedQuery: changedQueryForLog,
      changedResult: changedResultForLog,
      maxRows: options.maxRows,
    });

    return {
      actualSet: changedUris,
      details: {
        rowLimit: options.maxRows,
        recoveryUsed: true,
        actualCount: changedUris.size,
        originalSelectVars: plan.originalSelectVars,
        rewrittenSelectVars: plan.rewrittenSelectVars,
        primaryReplacementByOriginalVar: Object.fromEntries(plan.primaryReplacementByOriginalVar.entries()),
      },
    };
  } catch (e: unknown) {
    await appendUriRecallLog({
      questionId,
      originalQuery: originalQueryForLog,
      originalResult: originalResultForLog,
      changedQuery: changedQueryForLog,
      changedResult: changedResultForLog,
      maxRows: options.maxRows,
      error: stringifyError(e),
    });

    throw e;
  }
}

// ---------------------------------------------------------------------------
// Final score calculation
// ---------------------------------------------------------------------------

/**
 * Compute the set-based recall value.
 *
 * Empty-set convention:
 * - expected = empty, actual = empty   -> 1
 * - expected = empty, actual != empty  -> 0
 */
function computeRecallScore(expectedSet: Set<string>, actualSet: Set<string>): number {
  if (expectedSet.size === 0) {
    return actualSet.size === 0 ? 1 : 0;
  }

  let intersectionCount = 0;
  for (const uri of expectedSet) {
    if (actualSet.has(uri)) {
      intersectionCount += 1;
    }
  }

  return intersectionCount / expectedSet.size;
}

/**
 * Compute the set-based precision value.
 *
 * Convention:
 * precision = |expected ∩ actual| / |actual|
 *
 * Empty-set convention:
 * - expected = empty, actual = empty   -> 1
 * - expected = empty, actual != empty  -> 0
 * - expected != empty, actual = empty  -> 0
 */
function computePrecisionScore(expectedSet: Set<string>, actualSet: Set<string>): number {
  if (expectedSet.size === 0) {
    return actualSet.size === 0 ? 1 : 0;
  }

  if (actualSet.size === 0) {
    return 0;
  }

  let intersectionCount = 0;
  for (const uri of expectedSet) {
    if (actualSet.has(uri)) {
      intersectionCount += 1;
    }
  }

  return intersectionCount / actualSet.size;
}


// ---------------------------------------------------------------------------
// Metric factory and implementation
// ---------------------------------------------------------------------------

/**
 * Core metric implementation shared by both public error modes.
 */
async function scoreInternal(
  input: MetricInput,
  options: Required<MetricOptions>,
  isRecall: boolean

): Promise<MetricScore> {
  const runId = String((input as any)?.runId ?? "").trim();
  const questionId = String((input as any)?.questionId ?? "").trim();

  if (!runId) {
    throw new MetricExecutionError("invalid_input", "model_element_uri_recall requires input.runId.");
  }

  if (!questionId) {
    throw new MetricExecutionError("invalid_input", "model_element_uri_recall requires input.questionId.");
  }

  if (!Array.isArray((input as any).modelElementURIs)) {
    throw new MetricExecutionError(
      "invalid_input",
      "model_element_uri_recall requires input.modelElementURIs from evaluation_core."
    );
  }

  const expectedSet = new Set<string>();
  for (const uri of (input as any).modelElementURIs ?? []) {
    if (typeof uri !== "string") continue;
    const value = uri.trim();
    if (!value) continue;
    expectedSet.add(value);
  }

  const runDir = await resolveRunDirFromRunId(runId);
  const runMeta = await loadRunMeta(runDir);
  const { actualSet, details } = await resolveActualUriSet(runDir, runMeta, questionId, options);
  const value = isRecall ? computeRecallScore(expectedSet, actualSet) : computePrecisionScore(expectedSet, actualSet);

  return {
    value,
    status: "OK",
    details: {
      ...details,
      expectedCount: expectedSet.size,
      actualCount: actualSet.size,
      intersectionCount: sortedValues(expectedSet).filter((uri) => actualSet.has(uri)).length,
    },
  };
}

/**
 * Factory that exposes the metric with configurable runtime behavior.
 *
 * Supported options:
 * - `onError: "throw"` -> return ERROR/null when execution fails
 * - `onError: "zero"`  -> degrade failures to value=0 and keep the error string
 * - `maxRows`          -> how many returned rows are inspected
 */
export function createModelElementUriRecallMetric(options: MetricOptions = {}): Metric {
  const resolvedOptions: Required<MetricOptions> = {
    onError: options.onError ?? "throw",
    maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
  };

  return {
    name: "model_element_uri_recall",

    async score(input: MetricInput): Promise<MetricScore> {
      try {
        return await scoreInternal(input, resolvedOptions, true);
      } catch (e: unknown) {
        const error = stringifyError(e);

        if (resolvedOptions.onError === "zero") {
          return {
            value: 0,
            status: "OK",
            details: {
              degradedByError: true,
              errorMode: "zero",
            },
            error,
          } as MetricScore;
        }

        return {
          value: null,
          status: "ERROR",
          error,
        };
      }
    },
  };
}

/**
 * Factory that exposes the metric with configurable runtime behavior.
 *
 * Supported options:
 * - `onError: "throw"` -> return ERROR/null when execution fails
 * - `onError: "zero"`  -> degrade failures to value=0 and keep the error string
 * - `maxRows`          -> how many returned rows are inspected
 */
export function createModelElementUriPrecisionMetric(options: MetricOptions = {}): Metric {
  const resolvedOptions: Required<MetricOptions> = {
    onError: options.onError ?? "throw",
    maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
  };

  return {
    name: "model_element_uri_precision",
    async score(input: MetricInput): Promise<MetricScore> {
      try {
        return await scoreInternal(input, resolvedOptions, false);
      } catch (e: unknown) {
        const error = stringifyError(e);

        if (resolvedOptions.onError === "zero") {
          return {
            value: 0,
            status: "OK",
            details: {
              degradedByError: true,
              errorMode: "zero",
            },
            error,
          } as MetricScore;
        }

        return {
          value: null,
          status: "ERROR",
          error,
        };
      }
    },
  };
}


/**
 * Default strict metric instance:
 * execution errors propagate as metric errors (`status: "ERROR"`).
 */
export const modelElementRecall = createModelElementUriRecallMetric({
  onError: "throw",
  maxRows: DEFAULT_MAX_ROWS,
});

/**
 * Lenient metric instance:
 * execution errors are downgraded to a numeric score of 0.
 */
export const modelElementUriRecallZeroOnError = createModelElementUriRecallMetric({
  onError: "zero",
  maxRows: DEFAULT_MAX_ROWS,
});

export const metricRecall = modelElementRecall;


/**
 * Default strict metric instance:
 * execution errors propagate as metric errors (`status: "ERROR"`).
 */
export const modelElementPrecision = createModelElementUriPrecisionMetric({
  onError: "throw",
  maxRows: DEFAULT_MAX_ROWS,
});

/**
 * Lenient metric instance:
 * execution errors are downgraded to a numeric score of 0.
 */
export const modelElementUriPrecisionZeroOnError = createModelElementUriPrecisionMetric({
  onError: "zero",
  maxRows: DEFAULT_MAX_ROWS,
});

export const metricPrecision = modelElementPrecision;
