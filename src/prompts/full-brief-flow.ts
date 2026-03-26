import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_ROUTING_PREAMBLE } from "./preamble.js";

export function registerFullBriefFlowPrompt(server: McpServer): void {
  server.prompt(
    "full-brief-flow",
    "End-to-end: research → write brief → create tasks → review for consistency. One prompt to rule them all.",
    {
      problem: z.string().describe("Describe the problem or initiative"),
      title: z.string().optional().describe("Optional title for the brief"),
    },
    ({ problem, title }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `${TOOL_ROUTING_PREAMBLE}Run the full brief-to-tasks flow for this problem:

"${problem}"
${title ? `Title: ${title}` : ""}

Steps:

1. **Research**: Call dotpm find_docs to check if any existing research, briefs, or notes relate to this problem. Read anything relevant with dotpm read_doc.

2. **Write Brief**: Call dotpm write_brief with the problem statement${title ? ` and title "${title}"` : ""}. Then expand every section of the brief template with concrete details based on the problem and any research found. Call dotpm update_doc to save the expanded content.

3. **Break into Tasks**: Based on the brief's Must Have and Should Have requirements, define dev tasks. Each task must follow the task template (call dotpm get_task_template to see it). Use simple English — short sentences, concrete examples. Then call dotpm create_tasks to create them in Linear.

4. **Review**: Call dotpm review_tasks to check for gaps, duplicates, and unclear items across all tasks.

5. **Report**: Give me a summary of what was created:
   - Brief path + Linear project URL
   - Task list with identifiers
   - Any review findings that need my attention

Do the whole thing. Only stop if something genuinely blocks you.`,
          },
        },
      ],
    }),
  );
}
