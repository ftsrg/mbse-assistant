import { Metric, MetricInput, MetricScore, normalizeWs } from "./metric_types";
import { AutoTokenizer, pipeline } from "@huggingface/transformers";

/**
 * Simplified BERTScore-style implementation for repeated JS/CPU evaluation.
 *
 * This scorer keeps the core BERTScore idea:
 * - tokenize candidate and reference with the model's own tokenizer
 * - obtain contextual token/subtoken representations for the full sentence
 * - compute pairwise cosine similarity
 * - apply greedy max matching to obtain precision, recall, and F1
 *
 * Intentional deviations from the canonical paper/repo setup:
 * - we use Xenova/bert-base-cased instead of the heavier official English default
 * - we use the Transformers.js feature-extraction pipeline as a simpler runtime path
 * - we do not implement IDF weighting in this version
 *
 * Why these deviations are acceptable here:
 * - the goal is stable repeated evaluation in a TypeScript / CPU environment
 * - the core token-level contextual matching logic is preserved
 * - the implementation stays small, understandable, and operationally practical
 *
 * Detailed rationale is documented next to the relevant code sections.
 */

type PipelineCallOptions = NonNullable<Parameters<typeof pipeline>[2]>;
type PipelineDevice = NonNullable<PipelineCallOptions["device"]>;
type PipelineDType = NonNullable<PipelineCallOptions["dtype"]>;

export type PRF = { precision: number; recall: number; f1: number };
export type BertScoreResult = {
  precision: number;
  recall: number;
  f1: number;
  tokenCounts: {
    candidate: number;
    reference: number;
  };
};

export type BertScoreOptions = {
  /**
 * Hugging Face model id to use through Transformers.js.
 *
 * Default:
 * - Xenova/bert-base-cased
 *
 * Rationale:
 * - the official English BERTScore setup commonly uses a heavier model
 * - this project prefers a lighter English-oriented encoder that is easier to
 *   run repeatedly in a TypeScript / CPU environment
 */
  modelName?: string;

  /**
   * Override the maximum tokenized length passed to the tokenizer.
   * If omitted, we use the model/tokenizer maximum length when available, otherwise 512.
   */
  maxLength?: number;

  /**
   * Forwarded to Transformers.js model loading when supported.
   * Kept explicit because BERTScore can be heavy and the caller may want to choose a backend.
   */
  device?: PipelineDevice;

  /**
   * Forwarded to Transformers.js model loading when supported.
   * `fp32` is conservative and avoids precision surprises.
   */
  dtype?: PipelineDType;
};

type NumericScalar = number | bigint;

type TensorLike = {
  data: ArrayLike<NumericScalar>;
  dims: number[];
};

type LoadedResources = {
  modelName: string;
  tokenizer: any;
  extractor: any;
  device: PipelineDevice;
  dtype: PipelineDType;
};

type TokenizedSentence = {
  inputIds: number[];
  attentionMask: number[];
  specialTokensMask: number[];
};

type ContextualSentence = {
  tokenVectors: number[][];
};


// Official English BERTScore setups often use a larger backbone such as roberta-large.
// We intentionally use Xenova/bert-base-cased here because this project prioritizes
// repeated, practical TS/CPU execution over maximum benchmark-style fidelity.
export const DEFAULT_BERTSCORE_MODEL = "Xenova/bert-base-cased";
const DEFAULT_DEVICE: PipelineDevice = "cpu";
const DEFAULT_DTYPE: PipelineDType = "fp32";
const FALLBACK_MAX_LENGTH = 512;

let cachedResources: LoadedResources | null = null;

/**
 * Convert tensor scalars that may arrive as bigint into plain JavaScript numbers.
 */
function toNumber(value: NumericScalar): number {
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * Runtime check used by the tensor conversion helpers below.
 */
function isTensorLike(value: unknown): value is TensorLike {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Partial<TensorLike>;
  return Array.isArray(maybe.dims) && maybe.data != null;
}

/**
 * Convert a tokenizer/model output field into a 1D number array.
 *
 * Transformers.js often returns tensors with batch dimension [1, seq_len]. In that case we strip the
 * batch dimension because this implementation scores one sentence pair at a time.
 */
function fieldToVector(field: unknown, fieldName: string): number[] {
  if (Array.isArray(field)) {
    if (field.length > 0 && Array.isArray(field[0])) {
      return (field[0] as NumericScalar[]).map(toNumber);
    }
    return (field as NumericScalar[]).map(toNumber);
  }

  if (isTensorLike(field)) {
    const dims = field.dims.map(Number);
    const data = Array.from(field.data, toNumber);

    if (dims.length === 1) {
      return data;
    }

    if (dims.length === 2) {
      const [batchSize, seqLen] = dims;
      if (batchSize !== 1) {
        throw new Error(`${fieldName} expected batch size 1, got ${batchSize}.`);
      }
      return data.slice(0, seqLen);
    }
  }

  throw new Error(`Could not convert ${fieldName} to a 1D vector.`);
}

/**
 * Convert feature-extraction output into a [seq_len, hidden_size] matrix.
 *
 * The feature-extraction pipeline may return either [seq_len, hidden_size]
 * or [1, seq_len, hidden_size]. This helper normalizes both cases into the
 * same internal representation used by the scorer.
 */
function fieldToMatrix(field: unknown, fieldName: string): number[][] {
  if (!isTensorLike(field)) {
    throw new Error(`Could not convert ${fieldName} to a token embedding matrix.`);
  }

  const dims = field.dims.map(Number);
  const data = Array.from(field.data, toNumber);

  if (dims.length === 2) {
    const [seqLen, hiddenSize] = dims;
    const matrix: number[][] = [];
    for (let i = 0; i < seqLen; i++) {
      const start = i * hiddenSize;
      matrix.push(data.slice(start, start + hiddenSize));
    }
    return matrix;
  }

  if (dims.length === 3) {
    const [batchSize, seqLen, hiddenSize] = dims;
    if (batchSize !== 1) {
      throw new Error(`${fieldName} expected batch size 1, got ${batchSize}.`);
    }

    const matrix: number[][] = [];
    for (let i = 0; i < seqLen; i++) {
      const start = i * hiddenSize;
      matrix.push(data.slice(start, start + hiddenSize));
    }
    return matrix;
  }

  throw new Error(`Unexpected tensor rank for ${fieldName}: ${dims.length}.`);
}

/**
 * Standard L2 normalization so that a dot product becomes cosine similarity.
 */
function l2Normalize(vector: number[]): number[] {
  let normSq = 0;
  for (const value of vector) normSq += value * value;
  const norm = Math.sqrt(normSq);

  if (norm === 0) {
    // A zero vector should be extremely unusual here, but returning a same-sized zero vector keeps the
    // downstream math defined.
    return vector.map(() => 0);
  }

  return vector.map((value) => value / norm);
}

/**
 * Compute a plain dot product between two same-dimensional vectors.
 */
function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}.`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Resolve the effective runtime options while keeping defaults in one place.
 */
function resolveOptions(options: BertScoreOptions = {}): {
  modelName: string;
  device: PipelineDevice;
  dtype: PipelineDType;
  maxLength?: number;
} {
  return {
    modelName: options.modelName ?? DEFAULT_BERTSCORE_MODEL,
    device: options.device ?? DEFAULT_DEVICE,
    dtype: options.dtype ?? DEFAULT_DTYPE,
    maxLength: options.maxLength
  };
}

/**
 * Load and cache the tokenizer and feature-extraction pipeline.
 *
 * Why this differs from a heavier canonical reproduction:
 * - canonical BERTScore implementations often expose more model-specific control
 *   over internal layers and model backbones
 * - here we prefer a simpler, stable Transformers.js execution path
 *
 * Why this is still faithful in spirit:
 * - the scorer still uses model-native tokenization
 * - the scorer still uses contextual token representations from the full sentence
 * - caching affects latency only, not the score definition
 */
async function loadResources(options: {
  modelName: string;
  device: PipelineDevice;
  dtype: PipelineDType;
}): Promise<LoadedResources> {
  if (
    cachedResources &&
    cachedResources.modelName === options.modelName &&
    cachedResources.device === options.device &&
    cachedResources.dtype === options.dtype
  ) {
    return cachedResources;
  }

  const tokenizer = await AutoTokenizer.from_pretrained(options.modelName);
  const extractor = await pipeline("feature-extraction", options.modelName, {
    device: options.device,
    dtype: options.dtype,
  });

  cachedResources = {
    modelName: options.modelName,
    tokenizer,
    extractor,
    device: options.device,
    dtype: options.dtype,
  };

  return cachedResources;
}

/**
 * Choose the tokenizer length limit used for candidate/reference encoding.
 *
 * This implementation relies on the tokenizer's declared maximum length and
 * falls back to 512 when no trustworthy limit is available.
 *
 * This is a practical runtime decision, not a change to the matching logic itself.
 */
function resolveMaxLength(tokenizer: any, override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }

  const tokenizerMax = Number(tokenizer?.model_max_length ?? tokenizer?.modelMaxLength);

  return Number.isFinite(tokenizerMax) && tokenizerMax > 0 && tokenizerMax < 100000
    ? Math.floor(tokenizerMax)
    : FALLBACK_MAX_LENGTH;
}

/**
 * Build a special-token mask if the tokenizer did not return one explicitly.
 */
function inferSpecialTokensMask(inputIds: number[], tokenizer: any): number[] {
  const specialIds = new Set<number>();

  const maybeSpecialIds = tokenizer?.all_special_ids;
  if (Array.isArray(maybeSpecialIds)) {
    for (const id of maybeSpecialIds) specialIds.add(toNumber(id));
  }

  if (tokenizer?.cls_token_id != null) specialIds.add(toNumber(tokenizer.cls_token_id));
  if (tokenizer?.sep_token_id != null) specialIds.add(toNumber(tokenizer.sep_token_id));
  if (tokenizer?.pad_token_id != null) specialIds.add(toNumber(tokenizer.pad_token_id));

  return inputIds.map((id) => (specialIds.has(id) ? 1 : 0));
}

/**
 * Tokenize with the model's own tokenizer.
 *
 * This is one of the key places where we stay close to BERTScore:
 * scoring is based on model-native token/subtoken segmentation rather than
 * whitespace tokenization or project-specific text normalization.
 */
async function tokenizeSentence(text: string, tokenizer: any, maxLength: number): Promise<TokenizedSentence> {
  const encoded = await tokenizer(text, {
    add_special_tokens: true,
    truncation: true,
    max_length: maxLength,
    return_attention_mask: true,
    return_special_tokens_mask: true,
  });

  const inputIds = fieldToVector((encoded as any).input_ids, "input_ids");
  const attentionMask = (encoded as any).attention_mask
    ? fieldToVector((encoded as any).attention_mask, "attention_mask")
    : Array.from({ length: inputIds.length }, () => 1);

  const specialTokensMask = (encoded as any).special_tokens_mask
    ? fieldToVector((encoded as any).special_tokens_mask, "special_tokens_mask")
    : inferSpecialTokensMask(inputIds, tokenizer);

  return {
    inputIds,
    attentionMask,
    specialTokensMask,
  };
}


/**
 * Encode one full sentence and keep only non-special token vectors.
 *
 * Why this stays close to BERTScore:
 * - token vectors are produced in full-sentence context
 * - matching happens at the token/subtoken level
 * - special tokens are removed before scoring
 *
 * Why this differs from a heavier paper-style implementation:
 * - we use the feature-extraction pipeline output directly
 * - we do not expose explicit internal-layer tuning in this version
 */
async function encodeContextualSentence(
  text: string,
  tokenizer: any,
  extractor: any,
  maxLength: number,
): Promise<ContextualSentence> {
  const tokenized = await tokenizeSentence(text, tokenizer, maxLength);

  const extractorOutput = await extractor(text, {
    pooling: "none",
    normalize: false,
  });

  const allTokenVectors = fieldToMatrix(extractorOutput, "feature_extraction_output");

  if (allTokenVectors.length !== tokenized.inputIds.length) {
    throw new Error(
      `Tokenizer/extractor length mismatch: ${allTokenVectors.length} vs ${tokenized.inputIds.length}.`
    );
  }

  const tokenVectors: number[][] = [];

  for (let i = 0; i < tokenized.inputIds.length; i++) {
    const attended = tokenized.attentionMask[i] === 1;
    const isSpecial = tokenized.specialTokensMask[i] === 1;

    if (!attended || isSpecial) {
      continue;
    }

    tokenVectors.push(l2Normalize(allTokenVectors[i]));
  }

  return { tokenVectors };
}

/**
 * Pure similarity-matrix core.
 *
 * `sim[i][j]` is the cosine similarity between candidate token i and reference token j.
 *
 * Precision:
 * - for each candidate token, keep only its best reference match
 * - average those maxima over candidate tokens
 *
 * Recall:
 * - for each reference token, keep only its best candidate match
 * - average those maxima over reference tokens
 *
 * This is the greedy max-matching core that the metric keeps from BERTScore.
 */
export function bertScoreFromSim(
  sim: number[][]
): PRF {
  const candidateCount = sim.length;
  const referenceCount = sim[0]?.length ?? 0;

  if (candidateCount === 0 || referenceCount === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  // Precision: for every candidate token, keep only its best reference match.
  let precision = 0;
  for (let i = 0; i < candidateCount; i++) {
    let rowMax = -Infinity;
    for (let j = 0; j < referenceCount; j++) {
      rowMax = Math.max(rowMax, sim[i][j]);
    }
    precision += rowMax;
  }
  
  precision /= candidateCount;

  // Recall: for every reference token, keep only its best candidate match.
  let recall = 0;
  for (let j = 0; j < referenceCount; j++) {
    let columnMax = -Infinity;
    for (let i = 0; i < candidateCount; i++) {
      columnMax = Math.max(columnMax, sim[i][j]);
    }
    recall += columnMax;
  }

  recall /= referenceCount;

  const f1 = (precision + recall) > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  return { precision, recall, f1 };
}

/**
 * Build the full candidate-reference similarity matrix from contextual token vectors,
 * then apply greedy max matching on that matrix.
 */
export function bertScoreFromEmbeddings(
  candidateVectors: number[][],
  referenceVectors: number[][]
): PRF {
  if (candidateVectors.length === 0 || referenceVectors.length === 0) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  const sim = candidateVectors.map((candidateVector) =>
    referenceVectors.map((referenceVector) => dot(candidateVector, referenceVector))
  );

  return bertScoreFromSim(sim);
}

/**
 * Score one candidate/reference pair.
 *
 * Operational notes:
 * - resources are cached across calls
 * - tokenization and contextual encoding are recomputed per sentence
 * - empty token sequences return zero scores instead of throwing
 */
export async function bertScore(
  candidate: string,
  reference: string,
  options: BertScoreOptions = {},
): Promise<BertScoreResult> {
  const resolved = resolveOptions(options);
  const resources = await loadResources({
    modelName: resolved.modelName,
    device: resolved.device,
    dtype: resolved.dtype,
  });
  const maxLength = resolveMaxLength(resources.tokenizer, resolved.maxLength);

  const [candidateSentence, referenceSentence] = await Promise.all([
    encodeContextualSentence(candidate, resources.tokenizer, resources.extractor, maxLength),
    encodeContextualSentence(reference, resources.tokenizer, resources.extractor, maxLength),
  ]);

  if (candidateSentence.tokenVectors.length === 0 || referenceSentence.tokenVectors.length === 0) {
    return {
      precision: 0,
      recall: 0,
      f1: 0,
      tokenCounts: {
        candidate: candidateSentence.tokenVectors.length,
        reference: referenceSentence.tokenVectors.length,
      },
    };
  }

  const { precision, recall, f1 } = bertScoreFromEmbeddings(
    candidateSentence.tokenVectors,
    referenceSentence.tokenVectors
  );

  return {
    precision,
    recall,
    f1,
    tokenCounts: {
      candidate: candidateSentence.tokenVectors.length,
      reference: referenceSentence.tokenVectors.length,
    },
  };
}

/**
 * Thin wrapper used by the surrounding evaluation pipeline.
 *
 * The wrapper reports the BERTScore-style F1 value as the main metric output
 * and includes precision/recall in the details for inspection.
 */
export const metric: Metric = {
  name: "bertscore",

  async score(input: MetricInput): Promise<MetricScore> {
    const expectedText = String(input.expected ?? "");
    if (!normalizeWs(expectedText)) {
      return {
        value: null,
        status: "SKIPPED",
        details: { reason: "missing_expected" },
      };
    }

    const gotText = String(input.got ?? "");
    const result = await bertScore(gotText, expectedText);

    return {
      value: result.f1,
      status: "OK",
      details: {
        precision: result.precision,
        recall: result.recall,
        f1: result.f1,
        tokenCounts: result.tokenCounts,
        model: DEFAULT_BERTSCORE_MODEL,
        implementation: "simplified BERTScore-style contextual scorer",
      },
    };
  },
};
