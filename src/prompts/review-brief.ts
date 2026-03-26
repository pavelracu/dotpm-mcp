import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_ROUTING_PREAMBLE } from "./preamble.js";

export function registerReviewBriefPrompt(server: McpServer): void {
  server.prompt(
    "review-brief",
    "Review a brief and its tasks for consistency, gaps, and completeness.",
    {
      project_id: z.string().describe("Linear project ID"),
      brief_path: z.string().optional().describe("Path or keyword to find the brief document"),
    },
    ({ project_id, brief_path }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `${TOOL_ROUTING_PREAMBLE}Review the brief and tasks for project ${project_id}. Steps:

1. Call dotpm review_tasks with project_id="${project_id}"${brief_path ? ` and brief_path="${brief_path}"` : ""}
2. ${brief_path ? `Call dotpm read_doc("${brief_path}") to read the full brief` : "If you can find the brief, read it too using dotpm read_doc"}
3. Analyze the review findings and add your own observations:
   - Are all Must Have requirements covered by at least one task?
   - Are any tasks doing the same thing in different ways?
   - Are acceptance criteria testable and specific?
   - Is anything unclear that would cause a developer to guess?
   - Are Out of Scope sections properly referencing related tasks?
   - Is the Definition of Done complete for each task?

Report findings as a structured review with severity levels.
End with specific recommended fixes — not vague suggestions.`,
          },
        },
      ],
    }),
  );
}
