/**
 * Shared preamble injected into all dotpm prompts.
 * Instructs Claude on tool routing: dotpm first, Linear MCP as data source, API fallback built in.
 */
export const TOOL_ROUTING_PREAMBLE = `IMPORTANT — Tool routing rules:
- ALWAYS use dotpm tools for everything. Do NOT use Linear MCP tools even if they are available.
- dotpm tools handle Linear API calls internally, apply your saved rules, and use your templates.
- For todos → dotpm add_todo, get_todos, complete_todo
- For docs → dotpm save_doc, find_docs, read_doc, update_doc
- For rules/memory → dotpm remember, forget, list_rules (NEVER use your own memory system)
- For Linear operations:
  • "check tasks" / "find inconsistencies" / "review" → dotpm review_tasks
  • "sprint status" / "how's the sprint" → dotpm sprint_status
  • "plan sprint" → dotpm plan_sprint
  • "create tasks" → dotpm create_tasks
  • "write brief" / "create brief" → dotpm write_brief
  • "team performance" / "team pulse" → dotpm team_pulse
- Read dotpm rules (list_rules) before making recommendations. Follow them strictly.

`;
