import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Metric, MetricInput, MetricScore, normalizeWs } from "./metric_types";

/**
 * LLM judge (majority vote) metric.
 *
 * Uses a judge model to decide PASS/FAIL by comparing the model answer to the expected answer.
 * Runs 3 independent judge calls and returns 1 if at least 2 votes are PASS, otherwise 0.
 */
type Vote = "PASS" | "FAIL";

function getJudgeModel(): string {
  return process.env.LLM_JUDGE_MODEL ?? "anthropic/claude-opus-4.6";
}

function getJudgeTemperature(): number {
  // temperature is bigger than 0 to introduce randomness in the votes
  const v = Number(process.env.LLM_JUDGE_TEMPERATURE ?? "0.2");
  return Number.isFinite(v) ? v : 0.2;
}

function buildPrompt(input: MetricInput): { system: string; user: string } {
  const got = normalizeWs(input.got);
  const exp = normalizeWs(input.expected);

  const base = [
    "You are a strict evaluator.",
    "Decide whether the model answer answers the question and matches the expected answer semantically.",
    "Ignore minor wording and formatting differences.",
    "If the model answer is missing key facts or contradicts the expected answer, it FAILS.",
    "Output exactly one token: PASS or FAIL. No extra text.",
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
    "",
    "EXPECTED ANSWER:",
    exp,
    "",
    "MODEL ANSWER:",
    got,
    "",
    "Return only PASS or FAIL.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

async function judgeOnce(input: MetricInput): Promise<Vote> {
  const { system, user } = buildPrompt(input);

  const llm = new ChatOpenAI({
    model: getJudgeModel(),
    temperature: getJudgeTemperature(),
  });

  const res = await llm.invoke([new SystemMessage(system), new HumanMessage(user)]);
  const txt = normalizeWs((res as any)?.content ?? "").toUpperCase();

  if (txt === "PASS") return "PASS";
  if (txt === "FAIL") return "FAIL";

  // robust fallback: pick first PASS/FAIL occurrence
  const m = /(PASS|FAIL)/.exec(txt);
  if (m?.[1] === "PASS") return "PASS";
  return "FAIL";
}

export const metric: Metric = {
  name: "llm_judge_majority",
  async score(input: MetricInput): Promise<MetricScore> {
    const got = normalizeWs(input.got);
    const expected = normalizeWs(input.expected);

    if (!expected) {
      return { value: null, status: "SKIPPED", details: { reason: "missing_expected" } };
    }
    if (!got && !expected) return { value: 1, status: "OK", details: { note: "both_empty" } };
    if (!got || !expected) return { value: 0, status: "OK", details: { note: "one_empty" } };

    const votes: Vote[] = [];
    try {
      for (let i = 0; i < 3; i++) votes.push(await judgeOnce({ ...input, got, expected, datasetKind: input.datasetKind }));
    } catch (e: any) {
      return {
        value: null,
        status: "ERROR",
        details: { reason: "judge_call_failed", message: String(e?.message ?? e) },
      };
    }

    const passCount = votes.filter(v => v === "PASS").length;
    const failCount = 3 - passCount;
    const majority: Vote = passCount >= 2 ? "PASS" : "FAIL";

    return {
      value: majority === "PASS" ? 1 : 0,
      status: "OK",
      details: {
        votes,
        passCount,
        failCount,
        majority,
        judgeModel: getJudgeModel(),
        judgeTemperature: getJudgeTemperature(),
      },
    };
  },
};