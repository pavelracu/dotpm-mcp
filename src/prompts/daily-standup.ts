import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_ROUTING_PREAMBLE } from "./preamble.js";

export function registerDailyStandupPrompt(server: McpServer): void {
  server.prompt(
    "daily-standup",
    "Check your todos, sprint status, and what needs attention today.",
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `${TOOL_ROUTING_PREAMBLE}Run my daily standup. Do these in parallel:

1. Call dotpm get_todos to see my open items
2. Call dotpm sprint_status to see the current sprint health

Then synthesize into a single briefing:
- What's on my plate today (todos)
- Sprint health (% complete, blockers, stale items)
- What needs attention first (prioritize by urgency)
- Any flags or risks

Keep it concise. Table format where possible.`,
          },
        },
      ],
    }),
  );
}
