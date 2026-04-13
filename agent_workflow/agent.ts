// automated_testing/agent.ts
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { EndpointSparqlTool} from "../tools/EndpointSparqlTool.ts";
import { DecisionLogTool } from "../tools/DecisionLogTool.ts";
import { FinalAnswerTool } from "../tools/FinalAnswerTools.ts";

import type {
  AgentCreateConfig,
  AgentRunInput,
  AgentRunResult,
  AgentStatus,
  BenchmarkAgent,
  TokenUsage
} from "./agent_interface.ts";


/**
 * Tool-loop agent expressed as a LangGraph state machine.
 * The benchmark runner (`run_questions.ts`) passes:
 * - endpointUrl
 * - datasetKind
 * - systemPromptText (already loaded from file)
 * - modelName, temperature, maxSteps
*/


// the function returns a factory that creates agents with the provided config (e.g. endpointUrl, modelName, etc.)
export function createToolLoopAgent(cfg: AgentCreateConfig): BenchmarkAgent {
  const { endpointUrl, datasetKind, systemPromptText, modelName, temperature, maxSteps } = cfg;

  // This helper function extracts token usage information from the LLM response, handling different possible formats for where the token usage data might be located in the response object.
  function extractTokenUsage(ai: any): TokenUsage {
    const tokenUsage =
      ai?.usage_metadata ??
      ai?.response_metadata?.token_usage ??
      ai?.response_metadata?.tokenUsage ??
      {};

    const inputTokens =
      Number(
        tokenUsage?.prompt_tokens ??
        tokenUsage?.input_tokens ??
        tokenUsage?.inputTokens ??
        tokenUsage?.promptTokens ??
        0
      ) || 0;

    const outputTokens =
      Number(
        tokenUsage?.completion_tokens ??
        tokenUsage?.output_tokens ??
        tokenUsage?.outputTokens ??
        tokenUsage?.completionTokens ??
        0
      ) || 0;

    const totalTokens =
      Number(
        tokenUsage?.total_tokens ??
        tokenUsage?.totalTokens ??
        inputTokens + outputTokens
      ) || (inputTokens + outputTokens);

    return {
      inputTokens,
      outputTokens,
      totalTokens,
    };
  }


  type ToolCall = { id: string; name: string; args: any };

  // Getting the tool calls is a bit tricky since it can be in different formats depending on the LLM and how the tools are called.
  // This helper function normalizes that into a consistent format for easier processing in the graph nodes.
  function getToolCalls(msg: any): ToolCall[] {
    const calls =
      (Array.isArray(msg?.tool_calls) ? msg.tool_calls : null) ??
      (Array.isArray(msg?.additional_kwargs?.tool_calls) ? msg.additional_kwargs.tool_calls : null) ??
      [];

    return calls
      .map((c: any, i: number) => {
        const id = String(c?.id ?? c?.tool_call_id ?? `tool_${i}`);
        const name = String(c?.name ?? c?.function?.name ?? "");
        let args: any = c?.args ?? c?.function?.arguments ?? {};
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            args = { __raw: args };
          }
        }
        return name ? { id, name, args } : null;
      })
      .filter(Boolean) as ToolCall[];
  }

  // This helper function summarizes the SPARQL tool output for logging in the events.
  // It tries to parse the output and extract useful info like row count for SELECT or boolean value for ASK.
  // If parsing fails or the format is unexpected, it returns an error summary.
  function summarizeSparqlOutput(toolOutput: string) {
    try {
      const o = JSON.parse(toolOutput);

      if (o?.status === "ok" && o?.type === "select") {
        return { type: "select", rowsFullCount: Number(o?.rowCount ?? 0) };
      }

      if (o?.status === "ok" && o?.type === "ask") {
        return { type: "ask", boolean: Boolean(o?.boolean) };
      }

      if (o?.status === "empty") {
        return { type: "select", rowsFullCount: 0, empty: true };
      }

      return {
        type: "error",
        errorType: String(o?.error ?? "unknown"),
        httpStatus: typeof o?.httpStatus === "number" ? o.httpStatus : undefined,
      };
    } catch {
      return { type: "error", errorType: "tool_output_parse_error" };
    }
  }

  
  // State of the agent as it goes through the graph. This is what gets passed between nodes and updated by the annotations.
  type AgentState = {
    messages: any[];
    events: any[];

    // loop counters
    step: number; // counts LLM calls
    maxSteps: number;
    llmCalls: number;
    toolExecs: number;

    // used to link tool_exec.parentCallId to last llm_call.callId
    lastCallId: string;

    // terminal outputs
    status: AgentStatus | null;
    finalAnswer: string | null;
    error: string | null;
    errorCode: string | null;

    // token usage accumulators
    tokenInputTotal: number;
    tokenOutputTotal: number;
    tokenTotal: number;
  };

  // The annotation schema defines how the state gets updated at each node.
  // It specifies reducers for each field to determine how new values are combined with old ones.
  const AgentStateAnnotation = Annotation.Root({
    // We want to accumulate messages and events over time, so the reducers concatenate new messages or events to the previous state's arrays.
    messages: Annotation<any[]>({
      reducer: (prev: any[], next: any[]) => prev.concat(next),
      default: () => [],
    }),
    events: Annotation<any[]>({
      reducer: (prev: any[], next: any[]) => prev.concat(next),
      default: () => [],
    }),

    // For the loop counters and lastCallId, we want to take the new value from the node's output (if provided) or keep the old value if the node doesn't specify it.
    // This allows nodes to only update the fields they care about without affecting others.
    // We set default values for the counters to 0 and lastCallId to an empty string at the start of the graph.
    step: Annotation<number>({ reducer: (...v: [number, number]) => v[1], default: () => 0 }),
    maxSteps: Annotation<number>({ reducer: (...v: [number, number]) => v[1], default: () => 0 }),
    llmCalls: Annotation<number>({ reducer: (...v: [number, number]) => v[1], default: () => 0 }),
    toolExecs: Annotation<number>({ reducer: (...v: [number, number]) => v[1], default: () => 0 }),
    lastCallId: Annotation<string>({ reducer: (...v: [string, string]) => v[1], default: () => "" }),
    tokenInputTotal: Annotation<number>({ reducer: (...v: [number, number]) => v[1], default: () => 0 }),
    tokenOutputTotal: Annotation<number>({ reducer: (...v: [number, number]) => v[1], default: () => 0 }),
    tokenTotal: Annotation<number>({ reducer: (...v: [number, number]) => v[1], default: () => 0 }),

    status: Annotation<AgentStatus | null>({
      reducer: (...v: [AgentStatus | null, AgentStatus | null]) => v[1],
      default: () => null,
    }),
    finalAnswer: Annotation<string | null>({ reducer: (...v: [string | null, string | null]) => v[1], default: () => null }),
    error: Annotation<string | null>({ reducer: (...v: [string | null, string | null]) => v[1], default: () => null }),
    errorCode: Annotation<string | null>({ reducer: (...v: [string | null, string | null]) => v[1], default: () => null }),
  });

  // Building the graph with nodes and edges.
  // Each node corresponds to a step in the agent's reasoning process (LLM call, tool execution, etc.) 
  // and has an associated function that takes the current state and returns updates to that state.
  return {

    // The main function that runs one question through the agent. It initializes the graph state and invokes the graph, then formats the final output.
    // Input: only the plain question text
    // Output: a benchmark-independent execution result
    async runOneQuestion(input: AgentRunInput): Promise<AgentRunResult> {
      const startedAtMs = Date.now();
      const nowIso = () => new Date().toISOString();

      // Tools are instantiated per question to avoid shared state.
      const sparqlTool = new EndpointSparqlTool({ endpoint: endpointUrl, datasetKind });
      const decisionTool = new DecisionLogTool();
      const finalTool = new FinalAnswerTool();

      // A mapping from tool names to tool instances for easy lookup during tool execution.
      const toolMap: Record<string, any> = {
        [sparqlTool.name]: sparqlTool,
        [decisionTool.name]: decisionTool,
        [finalTool.name]: finalTool,
      };

      // The LLM is also instantiated here and bound to the tools so that it can call them during the graph execution.
      const llm = new ChatOpenAI({
        model: modelName,
        temperature,
        apiKey: process.env.OPENAI_API_KEY,
        configuration: {
          baseURL: process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1",
        },
      }).bindTools([
        sparqlTool,
        decisionTool,
        finalTool,
      ]);

      const lastMessage = (state: AgentState) => state.messages[state.messages.length - 1];


      // NODES OF THE GRAPH:

      // The node of the graph that makes the LLM call. 
      // It updates the messages with the new LLM output, increments the step and llmCalls counters, and logs an event with details about the call.
      const llmCallNode = async (state: AgentState) => {
        const t0 = Date.now();
        const nextIndex = state.llmCalls + 1;
        const callId = `llm_${String(nextIndex).padStart(4, "0")}`;

        // We wrap the LLM call in a try-catch to handle any errors that might occur during the invocation. If an error occurs, we log it and return an error state.
        let ai: any;
        let tokenUsage;
        try {
          ai = await llm.invoke(state.messages);
          tokenUsage = extractTokenUsage(ai);
        } catch (e: any) {
          const message = `LLM invoke failed: ${String(e?.message ?? e)}`;
          return {
            status: "ERROR" as AgentStatus,
            error: message,
            errorCode: "LLM_ERROR",
            events: [
              {
                kind: "error",
                at: nowIso(),
                status: "ERROR",
                error: { code: "LLM_ERROR", message },
              },
            ],
          };
        }

        // We extract the content and tool calls from the LLM output for logging purposes. The content is truncated to 240 characters to avoid excessively long logs.
        const content = typeof ai?.content === "string" ? ai.content : "";
        const toolCalls = getToolCalls(ai);

        return {
          messages: [ai],
          lastCallId: callId,
          step: state.step + 1,
          llmCalls: state.llmCalls + 1,
          tokenInputTotal: state.tokenInputTotal + tokenUsage.inputTokens,
          tokenOutputTotal: state.tokenOutputTotal + tokenUsage.outputTokens,
          tokenTotal: state.tokenTotal + tokenUsage.totalTokens,
          events: [
            {
              kind: "llm_call",
              callId,
              node: "agent",
              tokenUsage,
              durationMs: Date.now() - t0,
              status: "OK",
              output: content.slice(0, 240),
              plannedToolCalls: toolCalls.map((c) => ({ id: c.id, name: c.name })),
            },
          ],
        };
      };

      // This node of the graph is responsible for executing the tools that the LLM called.
      // It iterates over the tool calls, looks up the corresponding tool, invokes it with the provided arguments, and logs events for each execution.
      // If a tool call results in a final answer, it updates the state accordingly and ends the graph.
      const execToolsNode = async (state: AgentState) => {

        // We get the last LLM output and extract the tool calls from it. 
        const ai = lastMessage(state);
        const calls = getToolCalls(ai);

        // We prepare arrays to accumulate new messages and events generated during tool execution.
        // We also keep track of the number of tool executions.
        const appendedMsgs: any[] = [];
        const evs: any[] = [];
        let toolExecs = state.toolExecs;

        // We iterate over the tool calls in the order they were called by the LLM. 
        // For each call, we look up the corresponding tool and invoke it with the provided arguments.
        for (const call of calls) {
          const tool = toolMap[call.name];
          const t1 = Date.now();
          const toolCallId = String(call.id ?? "");

          // If the tool is not found in our mapping, we log an error event and return an error state.
          if (!tool) {
            const message = `Unknown tool: ${String(call.name)}`;
            evs.push({
              kind: "tool_exec",
              toolCallId: toolCallId || `tool_${toolExecs + 1}`,
              parentCallId: state.lastCallId,
              toolName: String(call.name),
              durationMs: Date.now() - t1,
              status: "ERROR",
              request: { ...(call.args ?? {}) },
              resultSummary: null,
              error: { code: "UNKNOWN_TOOL", message },
            });
            evs.push({
              kind: "error",
              at: nowIso(),
              status: "ERROR",
              error: { code: "UNKNOWN_TOOL", message },
            });
            return {
              status: "ERROR" as AgentStatus,
              error: message,
              errorCode: "UNKNOWN_TOOL",
              events: evs,
            };
          }

          // If the tool is found, we invoke it and handle any errors that might occur during invocation. If an error occurs, we log it and return an error state.
          let toolOutput = "";
          try {
            toolOutput = await tool.invoke(call.args);
          } catch (e: any) {
            const message = `Tool invoke failed (${String(call.name)}): ${String(e?.message ?? e)}`;

            evs.push({
              kind: "tool_exec",
              toolCallId: toolCallId || `tool_${toolExecs + 1}`,
              parentCallId: state.lastCallId,
              toolName: String(call.name),
              durationMs: Date.now() - t1,
              status: "ERROR",
              request:
                call.name === "sparql_query"
                  ? { query: String(sparqlTool.lastExecutedQuery ?? (call.args?.query ?? "")) }
                  : call.name === "final_answer"
                    ? { answer: String(call.args?.answer ?? "") }
                    : { ...(call.args ?? {}) },
              resultSummary: null,
              error: { code: "TOOL_ERROR", message },
            });
            evs.push({
              kind: "error",
              at: nowIso(),
              status: "ERROR",
              error: { code: "TOOL_ERROR", message },
            });

            return {
              status: "ERROR" as AgentStatus,
              error: message,
              errorCode: "TOOL_ERROR",
              events: evs,
            };
          }

          toolExecs++;

          // After successful tool execution, we log an event with details about the execution, including a summary of the result for SPARQL queries.
          // We also append a new message with the tool output to the conversation.
          evs.push({
            kind: "tool_exec",
            toolCallId: toolCallId || `tool_${toolExecs}`,
            parentCallId: state.lastCallId,
            toolName: String(call.name),
            durationMs: Date.now() - t1,
            status: "OK",
            // For SPARQL queries, we log the query and the result summary, and for final_answer calls, we log the provided answer.
            request:
              call.name === "sparql_query"
                ? { query: String(sparqlTool.lastExecutedQuery ?? (call.args?.query ?? "")) }
                : call.name === "final_answer"
                  ? { answer: String(call.args?.answer ?? "") }
                  : { ...(call.args ?? {}) },
            resultSummary: call.name === "sparql_query" ? summarizeSparqlOutput(toolOutput) : null,
            error: null,
          });

          // We append the tool output as a new message in the conversation, which allows the LLM to see the results of its tool calls in subsequent steps.
          appendedMsgs.push(
            new ToolMessage({
              content: toolOutput,
              name: call.name,
              tool_call_id: call.id,
            } as any)
          );

          // If the tool call was to the final_answer tool, we consider the agent's reasoning process complete and update the state with the final answer and a finalize event.
          // This will lead to the graph ending after this node.
          if (call.name === "final_answer") {
            evs.push({
              kind: "decision",
              decisionType: "finalize",
              at: nowIso(),
              status: "OK",
              finalAnswer: toolOutput,
              afterCallId: state.lastCallId,
            });

            return {
              messages: appendedMsgs,
              toolExecs,
              status: "OK" as AgentStatus,
              finalAnswer: toolOutput,
              events: evs,
            };
          }
        }

        return {
          messages: appendedMsgs,
          toolExecs,
          events: evs,
        };
      };

      // This node handles the case where the LLM did not call any tools. In this case, we treat the LLM's output as the final answer and end the graph.
      const finalImplicitNode = async (state: AgentState) => {
        const ai = lastMessage(state);
        const answer = typeof ai?.content === "string" ? ai.content : "";

        return {
          status: "OK" as AgentStatus,
          finalAnswer: answer,
          events: [
            {
              kind: "decision",
              decisionType: "finalize",
              at: nowIso(),
              status: "OK",
              finalAnswer: answer,
              afterCallId: state.lastCallId,
              note: "implicit_finalize_no_tool_call",
            },
          ],
        };
      };

      // This node handles the case where the maximum number of steps is reached without arriving at a final answer.
      // It updates the state with a timeout status and logs an error event indicating that the max steps were exceeded.
      const timeoutNode = async (state: AgentState) => {
        const message = `Max steps reached (${state.maxSteps}) without final_answer.`;
        return {
          status: "TIMEOUT" as AgentStatus,
          error: message,
          errorCode: "MAX_STEPS",
          events: [
            {
              kind: "error",
              at: nowIso(),
              status: "ERROR",
              error: { code: "MAX_STEPS", message },
            },
          ],
        };
      };

      // CONDITIONAL EDGES OF THE GRAPH:

      // This conditional edge of the graph determines the next node after the LLM call based on whether the LLM called any tools.
      // If there are tool calls, it goes to the exec_tools node, if not, it goes to the final_implicit node.
      // If the state already has a status (e.g. from an error), it goes to the end.
      const edgeAfterLlm = (state: AgentState) => {
        if (state.status) return "end";
        const ai = lastMessage(state);
        const calls = getToolCalls(ai);
        return calls.length === 0 ? "final_implicit" : "exec_tools";
      };

      // This conditional edge determines the next node after executing tools.
      // If a final answer was produced, it goes to the end. If the max steps were exceeded, it goes to the timeout node. 
      // Otherwise, it goes back to another LLM call for the next step of reasoning.
      const edgeAfterTools = (state: AgentState) => {
        if (state.status) return "end";
        if (state.step >= state.maxSteps) return "timeout";
        return "llm_call";
      };

      // THE GRAPH:

      const graph = new StateGraph(AgentStateAnnotation)
      // We add the nodes to the graph, specifying the function that should be executed at each node.
        .addNode("llm_call", llmCallNode)
        .addNode("exec_tools", execToolsNode)
        .addNode("final_implicit", finalImplicitNode)
        .addNode("timeout", timeoutNode)
        .addEdge(START, "llm_call")
        .addConditionalEdges("llm_call", edgeAfterLlm, {
          exec_tools: "exec_tools",
          final_implicit: "final_implicit",
          end: END,
        })
        .addConditionalEdges("exec_tools", edgeAfterTools, {
          llm_call: "llm_call",
          timeout: "timeout",
          end: END,
        })
        .addEdge("final_implicit", END)
        .addEdge("timeout", END)
        .compile();

      
      // We initialize the state of the graph with the system prompt and the human question, and then invoke the graph to run the agent's reasoning process.
      const initState: AgentState = {
        messages: [new SystemMessage(systemPromptText), new HumanMessage(input.questionText)],
        events: [],

        step: 0,
        maxSteps,
        llmCalls: 0,
        toolExecs: 0,
        lastCallId: "",
        tokenInputTotal: 0,
        tokenOutputTotal: 0,
        tokenTotal: 0,

        status: null,
        finalAnswer: null,
        error: null,
        errorCode: null,
      };

      // We set the recursion limit for the graph invocation to the maximum number of steps allowed for the agent, 
      // which is approximately twice the maximum steps, because there may be more than 1 node runs for each LLM call.
      const recursionLimit = maxSteps * 2;

      // The final state after invoking the graph contains all the accumulated messages, events, and the final status of the agent's reasoning process.
      const finalState = (await graph.invoke(initState, { recursionLimit })) as AgentState;
      const durationMs = Date.now() - startedAtMs;

      // We format the events by adding a sequential index to each event for easier analysis and debugging.
      const eventsWithSeq = (finalState.events ?? []).map((e: any, i: number) => ({ seq: i, ...(e ?? {}) }));


      const status: AgentStatus = finalState.status ?? "ERROR";
      const finalAnswer = status === "OK" ? finalState.finalAnswer : null;
      const errorObj =
        status === "OK" ? null : { code: finalState.errorCode ?? "ERROR", message: finalState.error ?? "" };

      // Finally, we return the structured output containing the question metadata, the final answer, the status, and the conversation trace with all events.
      return {
        status,
        finalAnswer,
        error: errorObj,
        durationMs,
        events: eventsWithSeq,
        counts: {
          llmCalls: finalState.llmCalls,
          toolExecs: finalState.toolExecs,
        },
        tokenUsage: {
          inputTokens: finalState.tokenInputTotal,
          outputTokens: finalState.tokenOutputTotal,
          totalTokens: finalState.tokenTotal,
        },
      };
    },
  };
}
