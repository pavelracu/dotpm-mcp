import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRules } from "../config/rules.js";

export function registerRulesResource(server: McpServer): void {
  server.resource(
    "rules",
    "dotpm://rules",
    {
      description: "Active workflow rules and conventions. These MUST be followed when generating recommendations, reviews, or creating artifacts. Rules are also injected into tool responses.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const rules = await loadRules();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: rules || "No rules configured. Use 'remember' to add workflow conventions.",
          },
        ],
      };
    },
  );
}
