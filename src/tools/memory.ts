import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRules, addRule, removeRule, saveRules } from "../config/rules.js";

export function registerMemoryTools(server: McpServer): void {
  server.tool(
    "add_rule",
    "ALWAYS use this (not Write/Edit tool on rules.md) to add a dotpm behavioral rule. Rules are injected into tool responses (review, sprint, tasks) so they can't be ignored. Use for: workflow constraints, team conventions, what tools should NOT recommend. NOT memory — tool configuration.",
    {
      rule: z.string().describe("The rule — e.g. 'Do not add estimates to tasks'"),
    },
    async ({ rule }) => {
      const updated = await addRule(rule);
      const count = updated.split("\n").filter((l) => l.trim()).length;
      return {
        content: [
          {
            type: "text" as const,
            text: `Rule added: "${rule}"\n${count} active rule(s).`,
          },
        ],
      };
    },
  );

  server.tool(
    "remove_rule",
    "ALWAYS use this (not Edit tool on rules.md) to remove a dotpm rule by keyword match. Use list_rules first to see what's active.",
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
            text: `Rule removed: ${result.rule}`,
          },
        ],
      };
    },
  );

  server.tool(
    "list_rules",
    "ALWAYS use this (not Read tool on rules.md) to show all active dotpm rules. These are injected into every tool response to control behavior.",
    {},
    async () => {
      const rules = await loadRules();
      if (!rules.trim()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No rules configured. Use 'add_rule' to set tool behavior constraints.",
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
    "ALWAYS use this (not Write tool on rules.md) to replace all dotpm rules at once. Use for bulk-editing tool behavior constraints.",
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
