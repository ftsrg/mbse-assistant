import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Metric, MetricInput, MetricScore, normalizeWs } from "./metric_types";

/**
 * LLM judge (1..5 score) metric.
 *
 * Uses a judge model to output an integer score (1..5) in JSON, runs 3 samples, and averages.
 */
function getJudgeModel(): string {
  return process.env.LLM_JUDGE_MODEL ?? "anthropic/claude-opus-4.6";
}

function getJudgeTemperature(): number {
  // temperature is bigger than 0 to increase diversity of outputs
  const v = Number(process.env.LLM_JUDGE_TEMPERATURE ?? "0.2");
  return Number.isFinite(v) ? v : 0.2;
}

function buildPrompt(input: MetricInput): { system: string; user: string } {
  const got = normalizeWs(input.got);
  const exp = normalizeWs(input.expected);

  const base = [
    "You are an evaluator.",
    "Score semantic similarity between MODEL ANSWER and EXPECTED ANSWER on an integer scale 1..5, based on how well the MODEL ANSWER answers the question and matches the EXPECTED ANSWER.",
    "1 = completely wrong / unrelated, 3 = partially correct but missing key points, 5 = fully correct.",
    "Ignore superficial wording differences.",
    "Output ONLY a JSON object: {\"score\": <1..5>} with an integer score. No extra text.",
  ].join(" ");

  const dataSetSpecificInfo = input.datasetKind === "bpmn"
    ? `The domain of the questions is BPMN 2.0 models used in SAP Signavio Academic Models.
       These models are aggregated into a single model, with the hierarchy being: corpus -> organization -> model -> BPMN:Definitions -> BPMN:Choreography -> other BPMN elements. 
       The models are related to the domain of business process management, and they are of several different languages, such as English, German, or Polish.`
    : input.datasetKind === "sparql"
      ? `The domain of the questions is the SysML model of a large-scale astronomical facility, the Thirty Meter Telescope (TMT).
         The questions are related to the structure and properties of the model, and they require understanding of the SysML language and the TMT domain.`
      : "";

  const system = [base, dataSetSpecificInfo].filter(Boolean).join(" ");
  
  const user = [
    input.question ? `QUESTION: ${input.question}` : "",
    "EXPECTED ANSWER:",
    exp,
    "",
    "MODEL ANSWER:",
    got,
    "",
    "Return only JSON: {\"score\": <1..5>}",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

function clampIntScore(x: number): number {
  if (!Number.isFinite(x)) return 1;
  const r = Math.round(x);
  return Math.min(5, Math.max(1, r));
}

async function scoreOnce(input: MetricInput): Promise<number> {
  const { system, user } = buildPrompt(input);

  const llm = new ChatOpenAI({
    model: getJudgeModel(),
    temperature: getJudgeTemperature(),
  });

  const res = await llm.invoke([new SystemMessage(system), new HumanMessage(user)]);
  const txt = normalizeWs((res as any)?.content ?? "");

  // strict JSON parse first
  try {
    const obj = JSON.parse(txt);
    return clampIntScore(Number(obj?.score));
  } catch {}

  // fallback: find a digit 1..5
  const m = /\b([1-5])\b/.exec(txt);
  if (m) return clampIntScore(Number(m[1]));

  return 1;
}

export const metric: Metric = {
  name: "llm_judge_score_avg",
  async score(input: MetricInput): Promise<MetricScore> {
    const got = normalizeWs(input.got);
    const expected = normalizeWs(input.expected);

    if (!expected) {
      return { value: null, status: "SKIPPED", details: { reason: "missing_expected" } };
    }
    if (!got && !expected) return { value: 5, status: "OK", details: { note: "both_empty" } };
    if (!got || !expected) return { value: 1, status: "OK", details: { note: "one_empty" } };

    const scores: number[] = [];
    try {
      for (let i = 0; i < 3; i++) scores.push(await scoreOnce({ ...input, got, expected, datasetKind: input.datasetKind }));
    } catch (e: any) {
      return {
        value: null,
        status: "ERROR",
        details: { reason: "judge_call_failed", message: String(e?.message ?? e) },
      };
    }

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    return {
      value: avg, // 1..5 float
      status: "OK",
      details: {
        scores,
        avg,
        judgeModel: getJudgeModel(),
        judgeTemperature: getJudgeTemperature(),
      },
    };
  },
};