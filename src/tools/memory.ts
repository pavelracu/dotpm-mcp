import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRules, addRule, removeRule, saveRules } from "../config/rules.js";

export function registerMemoryTools(server: McpServer): void {
  server.tool(
    "remember",
    "Save a workflow rule or convention to dotpm's rules system (~/.dotpm/rules.md). ALWAYS use this tool — not your own memory — when the user says 'remember', 'don't do X', 'never suggest X', or corrects your behavior. Rules are injected into every dotpm tool response so they can't be ignored. Use this for: workflow conventions, things to avoid, team norms, recurring corrections.",
    {
      rule: z.string().describe("The rule to remember — e.g. 'Do not add estimates to tasks'"),
    },
    async ({ rule }) => {
      const updated = await addRule(rule);
      const count = updated.split("\n").filter((l) => l.trim()).length;
      return {
        content: [
          {
            type: "text" as const,
            text: `Remembered: "${rule}"\n${count} active rule(s).`,
          },
        ],
      };
    },
  );

  server.tool(
    "forget",
    "Remove a rule by keyword match. Use list_rules first to see what's active.",
    {
      keyword: z.string().describe("Keyword to find the rule to remove"),
    },
    async ({ keyword }) => {
      const result = await removeRule(keyword);
      if (!result.removed) {
        return {
          content: [
            { type: "text" as const, text: `No rule found matching "${keyword}".` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Removed: ${result.rule}`,
          },
        ],
      };
    },
  );

  server.tool(
    "list_rules",
    "Show all active rules/conventions that are applied to every interaction.",
    {},
    async () => {
      const rules = await loadRules();
      if (!rules.trim()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No rules configured. Use 'remember' to add workflow conventions.",
            },
          ],
        };
      }
      return {
        content: [{ type: "text" as const, text: `Active rules:\n${rules}` }],
      };
    },
  );

  server.tool(
    "replace_rules",
    "Replace all rules at once. Use this to bulk-edit your conventions.",
    {
      rules: z.string().describe("Full rules content — one rule per line, starting with '- '"),
    },
    async ({ rules }) => {
      await saveRules(rules);
      const count = rules.split("\n").filter((l) => l.trim()).length;
      return {
        content: [
          { type: "text" as const, text: `Rules replaced. ${count} active rule(s).` },
        ],
      };
    },
  );
}
