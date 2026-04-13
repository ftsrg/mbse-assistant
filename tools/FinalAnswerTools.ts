// src/tools/finalAnswerTool.ts
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * FinalAnswerTool
 * --------------
 * A minimal "terminating" tool.
 *
 * What it is for:
 * - Return the final, user-facing text as ToolMessage.content.
 * - Signal to the workflow/orchestrator that the run is finished.
 *
 * Notes:
 * - This tool should usually be called exactly once at the end of an agent run.
 */
export class FinalAnswerTool extends StructuredTool {
  name = "final_answer";
  description = 
    "Use this tool *once* you have formulated the final answer.  \n" +
    'Input: {"answer":"<text to display>"}  •  Output: none (string is returned).';
  
  /** Input schema: a single required `answer` string. */
  schema = z.object({
    answer: z.string().describe("The final, user-facing answer"),
  });

  /**
   * Returns the final answer text.
   *
   * The orchestrator will typically render this string to the user and stop the workflow.
   */
  async _call({ answer }: { answer: string }) {
    // The returned value becomes ToolMessage.content.
    return answer;
  }
}
