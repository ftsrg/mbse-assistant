import { Metric, MetricInput, MetricScore } from "./metric_types";

/**
 * chrFβ (Popović, 2015) – character n-gram F-score.
 *
 * Reference:
 *   Popović, Maja. "chrF: character n-gram F-score for automatic MT evaluation."
 *   Proceedings of the Tenth Workshop on Statistical Machine Translation. 2015.
 *
 * Paper-faithful implementation choices:
 *   - character n-gram precision and recall are averaged arithmetically over n = 1..maxN
 *   - Fβ is then computed from those averaged precision/recall values (Eq. 1 in the paper)
 *   - default maxN = 6, matching the paper's standard chrF setting
 *   - default β = 1, matching the paper's standard chrF setting
 *   - whitespace is removed before extracting character n-grams, because the paper reports
 *     that treating spaces as additional characters did not improve correlations and was abandoned
 *   - no extra normalization beyond whitespace removal is applied: we do not lowercase and we do
 *     not strip punctuation, in order to avoid introducing behavior not described in the paper
 */

function prepareText(s: string): string {
  return String(s ?? "").replace(/\s+/gu, "");
}

/**
 * Count all character n-grams of length `n` in string `s` as a multiset.
 */
function charNgramCounts(s: string, n: number): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i + n <= s.length; i++) {
    const gram = s.slice(i, i + n);
    m.set(gram, (m.get(gram) ?? 0) + 1);
  }
  return m;
}

/**
 * Multiset overlap (clipped) between two n-gram count maps.
 *
 * Returns:
 *   - overlap:  sum_g min(countCand(g), countRef(g))
 *   - totalCand: total number of candidate n-grams (with multiplicity)
 *   - totalRef:  total number of reference n-grams (with multiplicity)
 */
function clippedOverlap(cand: Map<string, number>, ref: Map<string, number>) {
  let overlap = 0;
  let totalCand = 0;
  let totalRef = 0;

  for (const [, v] of cand) totalCand += v;
  for (const [, v] of ref) totalRef += v;

  for (const [gram, candCount] of cand) {
    const refCount = ref.get(gram);
    if (refCount !== undefined) {
      overlap += Math.min(candCount, refCount);
    }
  }

  return { overlap, totalCand, totalRef };
}

/**
 * chrFβ score for a single (candidate, reference) pair.
 *
 * This follows Popović (2015):
 *   CHRP = arithmetic mean of character n-gram precisions over n = 1..maxN
 *   CHRR = arithmetic mean of character n-gram recalls    over n = 1..maxN
 *   chrFβ = (1 + β²) * CHRP * CHRR / (β² * CHRP + CHRR)
 */
export function chrf(candidate: string, reference: string, maxN = 6, beta = 1.0): number {
  const C = prepareText(candidate);
  const R = prepareText(reference);

  if (!C.length || !R.length) return 0;

  let sumP = 0;
  let sumR = 0;

  for (let n = 1; n <= maxN; n++) {
    const cN = charNgramCounts(C, n);
    const rN = charNgramCounts(R, n);
    const { overlap, totalCand, totalRef } = clippedOverlap(cN, rN);

    const Pn = totalCand > 0 ? overlap / totalCand : 0;
    const Rn = totalRef > 0 ? overlap / totalRef : 0;

    sumP += Pn;
    sumR += Rn;
  }

  const CHRP = sumP / maxN;
  const CHRR = sumR / maxN;
  const beta2 = beta * beta;

  return (CHRP + CHRR) > 0
    ? ((1 + beta2) * CHRP * CHRR) / (beta2 * CHRP + CHRR)
    : 0;
}

export const metric: Metric = {
  name: "chrf",
  async score(input: MetricInput): Promise<MetricScore> {
    const expected = String(input.expected ?? "");
    if (!expected.trim()) {
      return { value: null, status: "SKIPPED", details: { reason: "missing_expected" } };
    }

    const beta = 1.0;
    const maxN = 6;
    const value = chrf(input.got, expected, maxN, beta);

    return { value, status: "OK", details: { beta, maxN } };
  },
};
