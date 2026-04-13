/**
 * Metric type definitions shared by all evaluation metrics.
 *
 * Key ideas:
 * - Every metric receives the same `MetricInput`.
 * - Every metric returns a `MetricScore` with a status and optional details.
 *
 * This repo uses a small status vocabulary:
 * - OK      -> metric computed successfully; `value` is a number
 * - SKIPPED -> metric intentionally not computed; `value` is null (e.g., missing expected)
 * - ERROR   -> metric failed unexpectedly; `value` is null and `error` may be set
 */

export type MetricStatus = "OK" | "SKIPPED" | "ERROR";

/**
 * Input passed to all metrics.
 *
 * Fields:
 * - runId:       optional run identifier
 * - questionId:  stable id like "q001"
 * - question:    optional question text (mainly useful for LLM-judge metrics)
 * - got:         the model-produced answer text
 * - expected:    the reference/expected answer text
 */
export interface MetricInput {
  runId?: string;
  questionId: string;
  question?: string;   // optional question text (mostly for LLM-judge metrics)
  got: string;         // model answer
  expected: string;    // expected answer
  modelElementURIs?: string[]; // optional list of model element URI-s relevant to the question
  datasetKind?: string; // optional dataset kind (e.g., "bpmn", "sparql") to guide metric behavior
}

/**
 * Standard output returned by metrics.
 *
 * Conventions:
 * - status === "OK"      => value is a number; error is usually absent
 * - status === "SKIPPED" => value is null; details.reason should explain why
 * - status === "ERROR"   => value is null; error is a short human-readable message
 *
 * `details` is intentionally flexible:
 * - It can contain metric-specific diagnostics (token counts, overlaps, votes, etc.)
 */
export interface MetricScore {
  value: number | null;
  status: MetricStatus;
  details?: Record<string, any>;
  error?: string; // optional error message when status === "ERROR"
}

/**
 * Metric interface implemented by each metric module.
 */
export interface Metric {
  name: string;
  score(input: MetricInput): Promise<MetricScore>;
}

/**
 * Whitespace normalization helper:
 * - collapses runs of whitespace
 * - trims leading/trailing whitespace
 *
 * This makes metrics more stable across minor formatting differences.
 */
export function normalizeWs(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}