import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readTemplate, writeTemplate } from "../config/manager.js";

export function registerTemplateTools(server: McpServer): void {
  server.tool(
    "get_template",
    "ALWAYS use this (not Read tool on template files) to view the current brief or task template. These templates control the structure used by write_brief and create_tasks.",
    {
      name: z.enum(["brief", "task"]).describe("Which template to view"),
    },
    async ({ name }) => {
      const content = await readTemplate(name);
      return {
        content: [
          {
            type: "text" as const,
            text: `--- ${name} template ---\n\n${content}`,
          },
        ],
      };
    },
  );

  server.tool(
    "update_template",
    "ALWAYS use this (not Write/Edit tool on template files) to replace the brief or task template. Changes the structure used by write_brief and create_tasks.",
    {
      name: z.enum(["brief", "task"]).describe("Which template to replace"),
      content: z.string().describe("New template content in markdown"),
    },
    async ({ name, content }) => {
      await writeTemplate(name, content);
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated ${name} template (${content.length} chars).`,
          },
        ],
      };
    },
  );
}
