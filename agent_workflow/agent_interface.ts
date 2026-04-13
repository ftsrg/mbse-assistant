
import type { DatasetKind } from "../tools/EndpointSparqlTool.ts";

/**
 * High-level execution status returned by the agent for one question.
 */
export type AgentStatus = "OK" | "ERROR" | "TIMEOUT";

/**
 * Aggregated token usage for one question run.
 *
 * These values are collected across all LLM calls performed while answering
 * a single benchmark question.
 */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/**
 * Configuration needed to create one concrete agent instance.
 *
 * This is the stable factory input contract that any benchmark-compatible
 * agent implementation must accept.
 */
export type AgentCreateConfig = {
  endpointUrl: string;
  datasetKind: DatasetKind;
  systemPromptText: string;
  modelName: string;
  temperature: number;
  maxSteps: number;
};

/**
 * Minimal input required to run the agent on one question.
 */
export type AgentRunInput = {
  questionText: string;
};

/**
 * Minimal benchmark-independent result returned by the agent.
 */
export type AgentRunResult = {
  status: AgentStatus;
  finalAnswer: string | null;
  error: { code: string; message: string } | null;
  durationMs: number;
  events: any[];
  counts: {
    llmCalls: number;
    toolExecs: number;
  };
  tokenUsage: TokenUsage;
};

/**
 * Common interface that every benchmark-compatible agent must implement.
 *
 * The benchmark runner should only depend on this interface, not on any
 * concrete agent internals such as LangGraph nodes or tool-loop helpers.
 */
export interface BenchmarkAgent {
  runOneQuestion(input: AgentRunInput): Promise<AgentRunResult>;
}