import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  isConfigured,
  loadConfig,
  saveConfig,
  initializeStorage,
  getDotpmDir,
} from "../config/manager.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { testConnection, resetLinearClient } from "../adapters/linear.js";
import { loadRules, saveRules, DEFAULT_RULES } from "../config/rules.js";

export const NOT_CONFIGURED_MSG = `dotpm is not set up yet. Run the "setup" tool to get started.

What you'll need:
• Linear API key (optional) — create one at linear.app/settings/api
  This unlocks: briefs, task creation, sprint tracking

Without Linear, you still get: todos, doc management, templates.`;

export function registerSetupTools(server: McpServer): void {
  server.tool(
    "setup",
    "First-time setup for dotpm. Creates config, templates, and doc folders. Linear API key is optional — you can add it later.",
    {
      linear_api_key: z
        .string()
        .optional()
        .describe("Your Linear API key (starts with lin_api_). Optional — skip to use dotpm without Linear."),
      linear_team_id: z
        .string()
        .optional()
        .describe("Your Linear team ID. Optional — we'll try to detect it."),
      linear_team_name: z
        .string()
        .optional()
        .describe("Your Linear team name for display purposes."),
    },
    async ({ linear_api_key, linear_team_id, linear_team_name }) => {
      // Build config
      const config = isConfigured()
        ? await loadConfig()
        : { ...DEFAULT_CONFIG };

      if (linear_api_key) {
        config.linear = {
          apiKey: linear_api_key,
          teamId: linear_team_id ?? "",
          teamName: linear_team_name ?? "",
        };
      }

      // Save config + create directory structure + default rules
      await saveConfig(config);
      await initializeStorage(config);

      // Initialize default rules if no rules exist yet
      const existingRules = await loadRules();
      if (!existingRules.trim()) {
        await saveRules(DEFAULT_RULES);
      }

      // Validate Linear if provided
      let linearStatus = "";
      if (linear_api_key) {
        resetLinearClient();
        const test = await testConnection();
        if (test.success) {
          linearStatus = `\n✓ Linear connected as: ${test.userName}`;

          // Auto-detect team if not provided
          if (!linear_team_id) {
            linearStatus += "\n  Tip: provide linear_team_id to unlock sprint and team tools.";
          }
        } else {
          linearStatus = `\n✗ Linear connection failed: ${test.error}\n  Check your API key and try setup again.`;
        }
      }

      const dir = getDotpmDir();
      return {
        content: [
          {
            type: "text" as const,
            text: `dotpm initialized at ${dir}

Created:
• config.json — your settings
• templates/brief.md — default brief template
• templates/task.md — default task template
• todos.md — your todo list
• docs/ — document storage (briefs, research, reports, strategy, people, notes, code)
${linearStatus}
${!linear_api_key ? "\nLinear not configured. Add it later with setup(linear_api_key: '...')" : ""}
Ready to go. Try:
• add_todo — add something to your list
• get_todos — see what's on your plate
• save_doc — save a document`,
          },
        ],
      };
    },
  );
}
