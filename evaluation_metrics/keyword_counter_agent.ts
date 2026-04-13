import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Metric, MetricInput, MetricScore, normalizeWs } from "./metric_types";

/**
 * LLM-based keyword coverage metric.
 *
 * What it measures:
 * - Each question may have a curated list of expected keywords or phrases.
 * - An LLM judge checks which of those keywords are present in the model answer.
 * - The returned score is:
 *     matched_keywords / total_keywords
 *
 * Important:
 * - This metric does not load keyword files on its own.
 * - The evaluator must pass the per-question keyword list in `input.keywords`.
 * - The returned structure is intentionally aligned with the simple keyword counter:
 *     details: { hit, total, hits }
 */

type JudgeResult = {
  matchedCount: number;
  totalCount: number;
  matchedKeywords: string[];
  missingKeywords: string[];
};

/**
 * Resolve the judge model name.
 * Default: openai/gpt-5-nano (a smaller, cheaper model for evaluation purposes).
 */
function getJudgeModel(): string {
  return process.env.KEYWORD_COUNTER_AGENT_MODEL ?? "anthropic/claude-opus-4.6";
}

/**
 * Resolve the judge temperature.
 * Default: 0 for deterministic behavior.
 */
function getJudgeTemperature(): number {
  const v = Number(process.env.KEYWORD_COUNTER_AGENT_TEMPERATURE ?? "0");
  return Number.isFinite(v) ? v : 0;
}

/**
 * Read the keyword list directly from metric input.
 * If the evaluator did not provide keywords, return an empty list.
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
 * Build the judge prompt.
 *
 * Prompt behavior:
 * - Be somewhat permissive for ordinary words and phrases.
 * - Accept inflected forms and close wording variants for normal descriptive terms.
 * - Be strict for IDs, codes, and model-specific proper names.
 * - Return JSON only.
 */
function buildPrompt(input: MetricInput, keywords: string[]): { system: string; user: string } {
  const got = normalizeWs(input.got);

  const system = [
    "You are a keyword coverage evaluator.",
    "Your task is to decide which expected keywords or key phrases are present in the model answer.",
    "Be somewhat permissive for ordinary words and phrases.",
    "Different inflected forms, common grammatical variants, and close wording variants may count as matches when they clearly express the same concept.",
    "For normal descriptive terms, exact surface-form matching is not required.",
    "But be strict for IDs, codes, and model-specific proper names.",
    "For identifiers and named model elements, count a match only if the exact item is present or the equivalence is unmistakable.",
    "Do not count a keyword if it is only weakly implied, only partially present, or contradicted.",
    "Return valid JSON only.",
    'Use exactly this schema: {"matchedCount": number, "totalCount": number, "matchedKeywords": string[], "missingKeywords": string[]}.',
    "Do not include any extra text."
  ].join(" ");

  const user = [
    "EXPECTED KEYWORDS:",
    JSON.stringify(keywords, null, 2),
    "",
    "MODEL ANSWER:",
    got || "(empty)",
    "",
    "Return JSON only."
  ].join("\n");

  return { system, user };
}

/**
 * Try to parse the judge result directly from JSON text.
 * If parsing succeeds, normalize the structure into JudgeResult.
 */
function tryParseJudgeResult(text: string, expectedKeywords: string[]): JudgeResult | null {
  try {
    const obj = JSON.parse(text) as Partial<JudgeResult>;

    const matchedKeywords = Array.isArray(obj.matchedKeywords)
      ? obj.matchedKeywords.map(String)
      : [];

    const missingKeywords = Array.isArray(obj.missingKeywords)
      ? obj.missingKeywords.map(String)
      : [];

    const matchedCount =
      typeof obj.matchedCount === "number" ? obj.matchedCount : matchedKeywords.length;

    const totalCount =
      typeof obj.totalCount === "number" ? obj.totalCount : expectedKeywords.length;

    return {
      matchedCount: Math.max(0, matchedCount),
      totalCount: Math.max(0, totalCount),
      matchedKeywords,
      missingKeywords,
    };
  } catch {
    return null;
  }
}

/**
 * Extract the first JSON object from a raw text response.
 * This is a fallback in case the judge returns extra wrapper text.
 */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Perform one judge call and parse its JSON response.
 */
async function judgeOnce(input: MetricInput, keywords: string[]): Promise<JudgeResult> {
  const { system, user } = buildPrompt(input, keywords);

  const llm = new ChatOpenAI({
    model: getJudgeModel(),
    temperature: getJudgeTemperature(),
  });

  const res = await llm.invoke([
    new SystemMessage(system),
    new HumanMessage(user),
  ]);

  const raw = String((res as any)?.content ?? "").trim();

  const direct = tryParseJudgeResult(raw, keywords);
  if (direct) return direct;

  const extracted = extractJsonObject(raw);
  if (extracted) {
    const parsed = tryParseJudgeResult(extracted, keywords);
    if (parsed) return parsed;
  }

  throw new Error(`Could not parse judge JSON response: ${raw}`);
}

export const metric: Metric = {
  name: "keyword_counter_agent",

  /**
   * Score keyword coverage for a single question.
   *
   * Return behavior:
   * - If no keywords exist: SKIPPED
   * - If the model answer is empty: OK, value = 0
   * - If the judge call fails: ERROR
   * - Otherwise: OK with value in [0..1]
   *
   * The returned details shape matches the simple keyword counter:
   *   { hit, total, hits }
   */
  async score(input: MetricInput): Promise<MetricScore> {
    const got = normalizeWs(input.got);
    const keywords = getKeywords(input);

    if (!keywords.length) {
      return {
        value: null,
        status: "SKIPPED",
        details: { reason: "no_keywords_for_question" },
      };
    }

    if (!got) {
      return {
        value: 0,
        status: "OK",
        details: {
          hit: 0,
          total: keywords.length,
          hits: [],
        },
      };
    }

    let judged: JudgeResult;
    try {
      judged = await judgeOnce(input, keywords);
    } catch (e: any) {
      return {
        value: null,
        status: "ERROR",
        details: {
          reason: "judge_call_failed",
          message: String(e?.message ?? e),
        },
      };
    }

    const total = keywords.length;
    const matched = Math.max(0, Math.min(judged.matchedCount, total));
    const fraction = total > 0 ? matched / total : 0;

    return {
      value: fraction,
      status: "OK",
      details: {
        hit: matched,
        total,
        hits: judged.matchedKeywords,
      },
    };
  },
};