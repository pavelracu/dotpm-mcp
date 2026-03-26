import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, readTemplate } from "../config/manager.js";
import { saveDoc } from "../adapters/storage.js";
import { createProject } from "../adapters/linear.js";

export function registerBriefTools(server: McpServer): void {
  server.tool(
    "write_brief",
    "ALWAYS use this (not Linear MCP) to create briefs. Saves to docs/briefs/ and creates a Linear project (status=Idea). Uses your brief template and applies saved rules.",
    {
      title: z.string().describe("Brief title — e.g. 'Progression Engine' or 'Order Migration v2'"),
      problem: z.string().describe("The problem statement. What's broken, who it affects, why it matters."),
      solution: z.string().optional().describe("Proposed solution — optional, can be filled in later"),
      create_linear_project: z
        .boolean()
        .optional()
        .default(true)
        .describe("Create a Linear project for this brief (default: true if Linear is configured)"),
    },
    async ({ title, problem, solution, create_linear_project }) => {
      const template = await readTemplate("brief");

      // Fill in the template
      let content = `# ${title}\n\n`;
      content += template
        .replace(
          /## Problem Statement\n.*/,
          `## Problem Statement\n${problem}`,
        );

      if (solution) {
        content = content.replace(
          /## Proposed Solution\n.*/,
          `## Proposed Solution\n${solution}`,
        );
      }

      // Save to docs
      const doc = await saveDoc(title, content, "briefs");

      // Create Linear project if configured
      let linearUrl = "";
      if (create_linear_project) {
        try {
          const config = await loadConfig();
          if (config.linear?.apiKey && config.linear.teamId) {
            const project = await createProject(
              config.linear.teamId,
              title,
              `Brief: ${problem.slice(0, 200)}`,
              "planned", // "Idea" equivalent in Linear API
            );
            linearUrl = project.url;
          }
        } catch {
          // Linear creation failed — doc still saved, that's fine
        }
      }

      let output = `Brief saved: ${doc.path}`;
      if (linearUrl) {
        output += `\nLinear project: ${linearUrl}`;
      }
      output += `\n\nThe brief has the default template structure. Ask me to expand any section — I'll use the problem statement as context.`;

      return { content: [{ type: "text" as const, text: output }] };
    },
  );
}
