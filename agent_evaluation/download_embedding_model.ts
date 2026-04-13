/**
 * Pre-download the model used by the paper-oriented BERTScore implementation.
 *
 * Run this once before evaluation runs:
 *   npx tsx agent_evaluation/download_embedding_model.ts
 *
 * Why this file exists:
 * - It downloads and caches the tokenizer and encoder weights ahead of time.
 * - It performs a tiny warm-up pass so that the first real evaluation run does not
 *   need to do model initialization work.
 *
 * Model choice:
 * - The official English BERTScore default is roberta-large.
 * - In this project we intentionally use Xenova/bert-base-cased as a lighter,
 *   faster model for repeated JavaScript / CPU execution.
 * - The scorer uses token-level contextual representations returned by the
  *  feature-extraction pipeline together with cosine similarity and greedy
  *  max matching.
 */

import "./hf_env";
import { pipeline } from "@huggingface/transformers";

const MODEL_NAME = "Xenova/bert-base-cased";
const DTYPE = "fp32";
const DEVICE = "cpu";
const WARMUP_TEXT = "Warm up the BERTScore model.";

/**
 * Extract a short, human-readable error message from an unknown thrown value.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Load the feature-extraction pipeline, then run a tiny warm-up pass.
 *
 * The warm-up call makes sure that:
 * - model files are really downloaded into the local cache,
 * - the pipeline can process text,
 * - token-level contextual embeddings are returned in the expected shape.
 */
async function downloadModel(): Promise<void> {
  console.log(`Downloading feature-extraction pipeline model: ${MODEL_NAME}`);
  console.log(`Device: ${DEVICE}`);
  console.log(`DType: ${DTYPE}`);
  console.log("This may take a while the first time because model files are cached locally.");
  console.log("");

  try {
    // Load a feature-extraction pipeline.
    // In Transformers.js this is the documented way to obtain token-level hidden states
    // from the base transformer without a task-specific head.
    const extractor = await pipeline("feature-extraction", MODEL_NAME, {
      dtype: DTYPE,
      device: DEVICE,
    });

    console.log("Model loaded. Running a short warm-up forward pass...");

    // IMPORTANT:
    // - Do not use pooling here.
    // - Do not normalize here.
    // We want token-level contextual representations with shape [1, seq_len, hidden_size].
    const outputs = await extractor(WARMUP_TEXT, { pooling: "none", normalize: false });

    if (!outputs || !Array.isArray(outputs.dims) || outputs.dims.length !== 3) {
      throw new Error(
        "Warm-up succeeded, but the extractor did not return a rank-3 tensor. " +
        "Expected token-level contextual embeddings with shape [1, seq_len, hidden_size]."
      );
    }

    console.log("");
    console.log("Model downloaded and warmed up successfully.");
    console.log(`Ready for evaluation runs with: ${MODEL_NAME}`);
  } catch (error: unknown) {
    console.error("");
    console.error("Error downloading or warming up the BERTScore model:");
    console.error(getErrorMessage(error));
    process.exit(1);
  }
}

void downloadModel();
