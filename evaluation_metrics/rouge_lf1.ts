import { Metric, MetricInput, MetricScore } from "./metric_types";

/**
 * ROUGE-L (Lin, 2004) – Longest Common Subsequence based summary overlap.
 *
 * This file follows the paper as closely as possible within the repository's
 * single-metric-file interface:
 *   - Section 3.1: sentence-level LCS recall / precision / F-measure
 *   - Section 3.2: summary-level union-LCS ROUGE-L
 *   - Section 2.1: multiple-reference max aggregation and jackknifing
 *
 * The repository metric export still returns a single scalar score, therefore
 * `metric.score()` reports β=1 ROUGE-L for one reference, or jackknifed
 * multi-reference ROUGE-L when the runtime provides multiple references.
 *
 * Paper reference:
 *   Lin, Chin-Yew. "ROUGE: A Package for Automatic Evaluation of Summaries."
 *   Text Summarization Branches Out, 2004.
 */

export interface RougeLScore {
  recall: number;
  precision: number;
  fScore: number;
  beta: number;
  unionLcs: number;
  referenceWords: number;
  candidateWords: number;
}

function getSegmenter(granularity: "sentence" | "word"): any | null {
  const IntlWithSegmenter = typeof Intl !== "undefined"
    ? (Intl as unknown as { Segmenter?: new (locale?: string | string[], options?: { granularity: "sentence" | "word" }) => any })
    : {};

  return typeof IntlWithSegmenter.Segmenter === "function"
    ? new IntlWithSegmenter.Segmenter(undefined, { granularity })
    : null;
}

/**
 * Split a summary into sentences.
 *
 * The paper defines summary-level ROUGE-L over sentences (Section 3.2), so raw
 * text must be segmented into sentences before union-LCS is computed.
 */
function splitSentences(text: string): string[] {
  const source = String(text ?? "").trim();
  if (!source) return [];

  const sentenceSegmenter = getSegmenter("sentence");
  if (sentenceSegmenter) {
    const sentences: string[] = [];
    for (const part of sentenceSegmenter.segment(source) as Iterable<{ segment: string }>) {
      const sentence = String(part.segment ?? "").trim();
      if (sentence) sentences.push(sentence);
    }
    if (sentences.length > 0) return sentences;
  }

  const sentences: string[] = [];
  const blocks = source.split(/\r?\n+/u);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const matches = trimmed.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/gu);
    if (matches && matches.length > 0) {
      for (const match of matches) {
        const sentence = match.trim();
        if (sentence) sentences.push(sentence);
      }
    } else {
      sentences.push(trimmed);
    }
  }

  return sentences;
}

/**
 * Tokenize a sentence into words.
 *
 * The paper works with sequences of words. We therefore tokenize into word-like
 * units without forcing extra normalization such as lowercasing, stemming, or
 * stopword removal.
 */
function tokenizeWords(text: string): string[] {
  const source = String(text ?? "");
  if (!source.trim()) return [];

  const wordSegmenter = getSegmenter("word");
  if (wordSegmenter) {
    const words: string[] = [];
    for (const part of wordSegmenter.segment(source) as Iterable<{ segment: string; isWordLike?: boolean }>) {
      if (part.isWordLike) {
        const word = String(part.segment ?? "");
        if (word) words.push(word);
      }
    }
    if (words.length > 0) return words;
  }

  return source.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? [];
}

function lcsLengthTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  return dp;
}

function lcsLength(a: string[], b: string[]): number {
  return lcsLengthTable(a, b)[a.length][b.length];
}

/**
 * Reference-token positions recovered from one classical LCS backtrace between
 * `reference` and `candidate`.
 *
 * Section 3.2 requires union-LCS across candidate sentences. We therefore
 * recover the reference positions matched by a standard dynamic-programming
 * LCS backtrace and union those positions over all candidate sentences.
 */
function lcsReferencePositions(reference: string[], candidate: string[]): Set<number> {
  const dp = lcsLengthTable(reference, candidate);
  const positions = new Set<number>();

  let i = reference.length;
  let j = candidate.length;

  while (i > 0 && j > 0) {
    if (reference[i - 1] === candidate[j - 1]) {
      positions.add(i - 1);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  return positions;
}

function rougeLFScore(recall: number, precision: number, beta: number): number {
  if (recall <= 0 || precision <= 0) return 0;
  const betaSq = beta * beta;
  return ((1 + betaSq) * recall * precision) / (recall + betaSq * precision);
}

/**
 * Section 3.1 (Eq. 2–4): sentence-level ROUGE-L between one reference sentence
 * and one candidate sentence.
 */
export function rougeLSentence(
  candidateSentence: string,
  referenceSentence: string,
  beta = 1,
): RougeLScore {
  const candidateWords = tokenizeWords(candidateSentence);
  const referenceWords = tokenizeWords(referenceSentence);

  if (candidateWords.length === 0 || referenceWords.length === 0) {
    return {
      recall: 0,
      precision: 0,
      fScore: 0,
      beta,
      unionLcs: 0,
      referenceWords: referenceWords.length,
      candidateWords: candidateWords.length,
    };
  }

  const lcs = lcsLength(referenceWords, candidateWords);
  const recall = lcs / referenceWords.length;
  const precision = lcs / candidateWords.length;

  return {
    recall,
    precision,
    fScore: rougeLFScore(recall, precision, beta),
    beta,
    unionLcs: lcs,
    referenceWords: referenceWords.length,
    candidateWords: candidateWords.length,
  };
}

/**
 * Section 3.2 (Eq. 5–7): summary-level ROUGE-L using union-LCS.
 */
export function rougeLSummary(
  candidateSummary: string,
  referenceSummary: string,
  beta = 1,
): RougeLScore {
  const candidateSentences = splitSentences(candidateSummary);
  const referenceSentences = splitSentences(referenceSummary);

  const candidateSentenceWords = candidateSentences.map(tokenizeWords);
  const referenceSentenceWords = referenceSentences.map(tokenizeWords);

  const candidateWordCount = candidateSentenceWords.reduce((sum, words) => sum + words.length, 0);
  const referenceWordCount = referenceSentenceWords.reduce((sum, words) => sum + words.length, 0);

  if (candidateWordCount === 0 || referenceWordCount === 0) {
    return {
      recall: 0,
      precision: 0,
      fScore: 0,
      beta,
      unionLcs: 0,
      referenceWords: referenceWordCount,
      candidateWords: candidateWordCount,
    };
  }

  let unionLcsTotal = 0;

  for (const referenceWords of referenceSentenceWords) {
    if (referenceWords.length === 0) continue;

    const unionPositions = new Set<number>();
    for (const candidateWords of candidateSentenceWords) {
      if (candidateWords.length === 0) continue;
      const positions = lcsReferencePositions(referenceWords, candidateWords);
      for (const pos of positions) unionPositions.add(pos);
    }

    unionLcsTotal += unionPositions.size;
  }

  const recall = unionLcsTotal / referenceWordCount;
  const precision = unionLcsTotal / candidateWordCount;

  return {
    recall,
    precision,
    fScore: rougeLFScore(recall, precision, beta),
    beta,
    unionLcs: unionLcsTotal,
    referenceWords: referenceWordCount,
    candidateWords: candidateWordCount,
  };
}

/**
 * Default ROUGE-L helper: summary-level union-LCS (Section 3.2).
 */
export function rougeL(
  candidateSummary: string,
  referenceSummary: string,
  beta = 1,
): RougeLScore {
  return rougeLSummary(candidateSummary, referenceSummary, beta);
}

function compareScores(a: RougeLScore, b: RougeLScore): number {
  if (a.fScore !== b.fScore) return a.fScore - b.fScore;
  if (a.recall !== b.recall) return a.recall - b.recall;
  if (a.precision !== b.precision) return a.precision - b.precision;
  return a.unionLcs - b.unionLcs;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageScores(scores: RougeLScore[], beta: number): RougeLScore {
  return {
    recall: mean(scores.map((score) => score.recall)),
    precision: mean(scores.map((score) => score.precision)),
    fScore: mean(scores.map((score) => score.fScore)),
    beta,
    unionLcs: mean(scores.map((score) => score.unionLcs)),
    referenceWords: mean(scores.map((score) => score.referenceWords)),
    candidateWords: mean(scores.map((score) => score.candidateWords)),
  };
}

/**
 * Section 2.1: with multiple references, take the maximum pairwise
 * summary-level ROUGE-L score.
 */
export function rougeLMultiReference(
  candidateSummary: string,
  referenceSummaries: readonly string[],
  beta = 1,
): RougeLScore {
  if (referenceSummaries.length === 0) {
    return {
      recall: 0,
      precision: 0,
      fScore: 0,
      beta,
      unionLcs: 0,
      referenceWords: 0,
      candidateWords: tokenizeWords(candidateSummary).length,
    };
  }

  let bestScore = rougeLSummary(candidateSummary, referenceSummaries[0], beta);
  for (let i = 1; i < referenceSummaries.length; i++) {
    const score = rougeLSummary(candidateSummary, referenceSummaries[i], beta);
    if (compareScores(score, bestScore) > 0) {
      bestScore = score;
    }
  }

  return bestScore;
}

/**
 * Section 2.1: ROUGE package jackknifing over M references.
 *
 * Given M references, compute the best score over each of the M leave-one-out
 * sets of size M-1, then average those M scores.
 */
export function rougeLMultiReferenceJackknife(
  candidateSummary: string,
  referenceSummaries: readonly string[],
  beta = 1,
): RougeLScore {
  if (referenceSummaries.length <= 1) {
    return referenceSummaries.length === 1
      ? rougeLSummary(candidateSummary, referenceSummaries[0], beta)
      : {
          recall: 0,
          precision: 0,
          fScore: 0,
          beta,
          unionLcs: 0,
          referenceWords: 0,
          candidateWords: tokenizeWords(candidateSummary).length,
        };
  }

  const leaveOneOutScores: RougeLScore[] = [];
  for (let excluded = 0; excluded < referenceSummaries.length; excluded++) {
    const subset: string[] = [];
    for (let i = 0; i < referenceSummaries.length; i++) {
      if (i !== excluded) subset.push(referenceSummaries[i]);
    }
    leaveOneOutScores.push(rougeLMultiReference(candidateSummary, subset, beta));
  }

  return averageScores(leaveOneOutScores, beta);
}

function coerceReferenceSummaries(expected: unknown): string[] {
  if (Array.isArray(expected)) {
    return expected
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }

  const single = String(expected ?? "").trim();
  return single ? [single] : [];
}

export const metric: Metric = {
  name: "rouge_l_f1",
  async score(input: MetricInput): Promise<MetricScore> {
    const references = coerceReferenceSummaries(input.expected as unknown);
    if (references.length === 0) {
      return { value: null, status: "SKIPPED", details: { reason: "missing_expected" } };
    }

    const beta = 1;
    const score = references.length === 1
      ? rougeLSummary(input.got, references[0], beta)
      : rougeLMultiReferenceJackknife(input.got, references, beta);

    return {
      value: score.fScore,
      status: "OK",
      details: {
        recall: score.recall,
        precision: score.precision,
        f1: score.fScore,
        beta: score.beta,
        unionLcs: score.unionLcs,
        referenceWords: score.referenceWords,
        candidateWords: score.candidateWords,
        referenceCount: references.length,
        aggregation: references.length === 1 ? "single_reference" : "jackknife_multi_reference",
      },
    };
  },
};
