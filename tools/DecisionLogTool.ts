import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * DecisionLogTool
 * ---------------
 * A tiny helper tool for developer-side logging.
 *
 * What it is for:
 * - Capture a short, high-level rationale about what the agent will do next.
 * - Store simple meta information (status, rowCount, errorType, etc.).
 * - Make debugging and evaluation easier.
 *
 * When to use:
 * - After each `sparql_query` result (so you can see what happened).
 * - Right before calling `final_answer` (or before deciding to retry).
 *
 * IMPORTANT:
 * - Keep the `reason` short and user-safe (1–3 sentences).
 * - Do not include detailed hidden reasoning.
 */
export class DecisionLogTool extends StructuredTool {
  name = "decision_log";
  description =
    "Log a short (2-3 sentences), high-level decision rationale to the developer console. " +
    "Use after each sparql_query result and before calling final_answer (or before retry).";

  schema = z.object({
    /** When the log entry is emitted: after SPARQL, or right before finalizing. */
    event: z.enum(["after_sparql", "finalizing"]),
    /** Status of the last SPARQL call. */
    status: z.enum(["ok", "empty", "error"]),
    /** Result row count (if known). */
    rowCount: z.number().int().nonnegative().optional(),
    /** Error category (if any): e.g. endpoint_error / parse_error / network_error. */
    errorType: z.string().optional(),
    /** Optional short message. Keep it brief. */
    message: z.string().optional(),
    /** Next step decision. */
    decision: z.enum(["retry", "finalize"]),
    /**
     * Short rationale (max ~2-3 sentences).
     * This must be safe to show to an end user, even though it is logged to the console.
     */
    reason: z.string(),
    /** Optional confidence score (0..1). */
    confidence: z.number().min(0).max(1).optional(),
  });

  async _call(args: any) {
    // Add a timestamp so you can correlate logs with other events.
    const payload = { ts: new Date().toISOString(), ...args };

    // Developer-only console log (not sent to the end user).
    console.log("\n=== DECISION LOG ===\n" + JSON.stringify(payload, null, 2) + "\n");

    // Return a tiny acknowledgement so the tool call has a valid ToolMessage.content.
    return JSON.stringify({ status: "logged" });
  }
}
