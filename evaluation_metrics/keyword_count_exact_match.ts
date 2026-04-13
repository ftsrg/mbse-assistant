import { Metric, MetricInput, MetricScore, normalizeWs } from "./metric_types";

/**
 * Keyword coverage metric.
 *
 * What it measures:
 * - Each question may have a curated list of keywords/phrases.
 * - Score = (number of keywords found in `got`) / (total keywords for that question).
 *
 * Important:
 * - This metric does not load any keyword files on its own.
 * - The evaluator is responsible for resolving and loading the correct keyword source.
 * - The metric only reads `input.keywords`.
 */

function getKeywords(input: MetricInput): string[] {
  const anyIn = input as any;
  const kws = anyIn?.keywords;

  if (!Array.isArray(kws)) {
    return [];
  }

  return kws.map(String).map((s) => s.trim()).filter(Boolean);
}

/**
 * Case-insensitive substring check after whitespace normalization.
 */
function containsCaseInsensitive(hay: string, needle: string): boolean {
  const h = normalizeWs(hay).toLowerCase();
  const n = normalizeWs(needle).toLowerCase();
  if (!n) return false;
  return h.includes(n);
}

export const metric: Metric = {
  name: "keyword_count_exact_match",

  async score(input: MetricInput): Promise<MetricScore> {
    const got = normalizeWs(input.got);
    const kws = getKeywords(input);

    if (!kws.length) {
      return {
        value: null,
        status: "SKIPPED",
        details: { reason: "no_keywords_for_question" },
      };
    }

    let hit = 0;
    const hits: string[] = [];

    for (const kw of kws) {
      if (containsCaseInsensitive(got, kw)) {
        hit++;
        hits.push(kw);
      }
    }

    const total = kws.length;
    const fraction = total > 0 ? hit / total : 0;

    return {
      value: fraction,
      status: "OK",
      details: { hit, total, hits },
    };
  },
};