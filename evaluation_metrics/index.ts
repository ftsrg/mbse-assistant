import type { Metric } from "./metric_types";

// Metric registry: this file determines which metrics are executed by the evaluator.

import { metric as keywordCount_Automatic } from "./keyword_count_exact_match.ts";
import { metric as keywordCounter_Agent } from "./keyword_counter_agent.ts";
import { metric as rougeLF1 } from "./rouge_lf1";
import { metric as chrf } from "./chr_f";
import { metric as bertScore } from "./bert_score";
import { metric as llmMajority } from "./llm_judge_majority.ts";
import { metric as llmScoreAvg } from "./llm_judge_score_avg.ts";
import { metric as cosineSimilarity } from "./cosine_similarity";
import { metricRecall as modelElementRecall, metricPrecision as modelElementPrecision } from "./model_element_uri_metric.ts";

/**
 * Public registry of metrics (name -> implementation).
 *
 * NOTE:
 * - We keep the registry explicit so you can easily control what runs in evaluation.
 */
export const METRICS: Record<string, Metric> = {
  keyword_count_exact_match: keywordCount_Automatic,
  keyword_counter_agent: keywordCounter_Agent,
  rouge_l_f1: rougeLF1,
  chrf: chrf,
  bertscore: bertScore,
  llm_judge_majority: llmMajority,
  llm_judge_score_avg: llmScoreAvg,
  cosine_similarity: cosineSimilarity,
  model_element_uri_recall: modelElementRecall,
  model_element_uri_precision: modelElementPrecision
};

/** Get a metric by name. */
export function getMetric(name: string): Metric | undefined {
  return METRICS[name];
}

/** List all registered metric names (sorted). */
export function listMetrics(): string[] {
  return Object.keys(METRICS).sort();
}
