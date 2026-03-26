import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WRITING_CONVENTIONS, LINEAR_CONVENTIONS } from "../config/defaults.js";
import { loadConfig } from "../config/manager.js";

export function registerConventionResources(server: McpServer): void {
  server.resource(
    "writing-conventions",
    "conventions://writing",
    {
      description: "Writing style rules — simple English for international teams, or standard professional English",
      mimeType: "application/json",
    },
    async (uri) => {
      let style: "simple" | "standard" = "simple";
      try {
        const config = await loadConfig();
        style = config.preferences.language;
      } catch {
        // Not configured yet, use default
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(WRITING_CONVENTIONS[style], null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    "linear-conventions",
    "conventions://linear",
    {
      description: "Linear workflow conventions — briefs are projects, no auto-assignment, no estimates unless asked",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(LINEAR_CONVENTIONS, null, 2),
        },
      ],
    }),
  );
}
