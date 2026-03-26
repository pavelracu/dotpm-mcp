import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_ROUTING_PREAMBLE } from "./preamble.js";

export function registerProcessTodoPrompt(server: McpServer): void {
  server.prompt(
    "process-todo",
    "Process a todo item: find related context, create the Linear artifact, mark it done.",
    { todo_id: z.string().describe("The todo ID to process (from get_todos)") },
    ({ todo_id }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `${TOOL_ROUTING_PREAMBLE}Process todo #${todo_id}. Follow these steps:

1. Call dotpm get_todos to read the todo item
2. Call dotpm find_docs to search for any existing research, briefs, or notes related to this todo (use keywords from the todo text)
3. If related docs exist, call dotpm read_doc to read them for context
4. Based on the todo and any context found:
   - If it's about creating a brief → call dotpm write_brief
   - If it's about creating tasks → call dotpm create_tasks
   - If it's about writing a doc → call dotpm save_doc
   - If it's something else → tell me what action makes sense
5. After creating the artifact, call dotpm complete_todo with the todo ID and link to what was created

Do NOT ask me what to do at each step — use your judgment based on the todo text and context. Only ask if the todo is genuinely ambiguous.`,
          },
        },
      ],
    }),
  );
}
