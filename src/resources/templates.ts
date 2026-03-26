import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readTemplate } from "../config/manager.js";

export function registerTemplateResources(server: McpServer): void {
  server.resource(
    "brief-template",
    "templates://brief",
    {
      description: "The active brief/PRD template used by write_brief",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const content = await readTemplate("brief");
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }],
      };
    },
  );

  server.resource(
    "task-template",
    "templates://task",
    {
      description: "The active task template used by create_tasks. Defines the structure every Linear issue should follow.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const content = await readTemplate("task");
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: content }],
      };
    },
  );
}
