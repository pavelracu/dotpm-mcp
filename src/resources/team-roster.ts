import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadTeam } from "../config/manager.js";

export function registerTeamRosterResource(server: McpServer): void {
  server.resource(
    "team-roster",
    "team://roster",
    {
      description: "Current team roster with roles, capabilities, and constraints",
      mimeType: "application/json",
    },
    async (uri) => {
      const team = await loadTeam();
      if (!team) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: "Team not configured. Use configure_team to set up your roster.",
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(team, null, 2),
          },
        ],
      };
    },
  );
}
