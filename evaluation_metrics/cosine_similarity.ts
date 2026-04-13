import { Metric, MetricInput, MetricScore, normalizeWs } from "./metric_types";
import { pipeline } from "@huggingface/transformers";

/**
 * Cosine similarity between embeddings of `got` and `expected`.
 *
 * Implementation:
 * - Uses @huggingface/transformers local embeddings (feature-extraction pipeline).
 * - Mean pooling + normalize=true means vectors are unit-length.
 * - Therefore cosine similarity equals the dot product.
 *
 * Behavior:
 * - SKIPPED when expected is missing/empty (cannot compare)
 * - OK with 0 when got is empty
 * - ERROR on unexpected embedding failures (error is a minimal string)
 */

let embeddingPipeline: any = null;

/**
 * Lazily create and cache the embedding pipeline.
 * The first call can download the model if not present in cache.
 */
async function getEmbedder() {
  if (!embeddingPipeline) {
    embeddingPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return embeddingPipeline;
}

/** Embed a text into a unit-normalized vector. */
async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

/** Dot product between vectors (for unit-normalized embeddings == cosine similarity). */
function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export const metric: Metric = {
  name: "cosine_similarity",
  /**
   * Score cosine similarity for (got, expected).
   */
  async score(input: MetricInput): Promise<MetricScore> {
    const expected = normalizeWs(input.expected);
    const got = normalizeWs(input.got);

    if (!expected) return { value: null, status: "SKIPPED", details: { reason: "missing_expected" } };
    if (!got) return { value: 0, status: "OK", details: { reason: "empty_answer" } };

    try {
      const [a, b] = await Promise.all([embed(got), embed(expected)]);
      // vectors are normalized => cosine similarity = dot
      const sim = dot(a, b);
      return { value: sim, status: "OK" };
    } catch (e: any) {
      return { value: null, status: "ERROR", error: String(e?.message ?? e), details: { reason: "embedding_error" } };
    }
  },
};