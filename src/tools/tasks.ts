import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, readTemplate } from "../config/manager.js";
import { resolveProject, createIssue, findProjects } from "../adapters/linear.js";
import { readDoc } from "../adapters/storage.js";
import { processInBatches } from "../utils.js";

export function registerTaskTools(server: McpServer): void {
  server.tool(
    "create_tasks",
    "ALWAYS use this (not Linear MCP) to create Linear issues. Creates team tasks from a brief — NOT personal action items (use add_todo for those). Tasks are created unassigned using your task template. Applies your saved rules.",
    {
      project: z
        .string()
        .optional()
        .describe("Linear project ID (UUID) or project name to create tasks under"),
      brief_path: z
        .string()
        .optional()
        .describe("Path or keyword to find the brief document"),
      tasks: z
        .array(
          z.object({
            title: z.string().describe("Task title — clear, actionable"),
            description: z.string().describe("Task description — should follow the task template structure"),
            priority: z
              .number()
              .optional()
              .describe("Priority: 1=Urgent, 2=High, 3=Medium, 4=Low"),
          }),
        )
        .describe("Array of tasks to create"),
    },
    async ({ project, brief_path, tasks }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey || !config.linear.teamId) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured with team ID." }],
          isError: true,
        };
      }

      // Resolve project by ID or name if provided
      let projectId: string | undefined;
      if (project) {
        const resolved = await resolveProject(config.linear.teamId, project);
        if (!resolved) {
          return {
            content: [{ type: "text" as const, text: `Linear project not found: "${project}"` }],
            isError: true,
          };
        }
        projectId = resolved.id;
      }

      // Read brief for context if path provided
      let briefContext = "";
      if (brief_path) {
        const doc = await readDoc(brief_path);
        if (doc) {
          briefContext = doc.content;
        }
      }

      // Create issues in batches of 5 to respect Linear rate limits
      const results = await processInBatches(tasks, 5, (task) =>
        createIssue(
          config.linear!.teamId,
          task.title,
          task.description,
          projectId,
          task.priority,
        ),
      );

      const output = results
        .map((r, i) => `  ${r.identifier}: ${tasks[i].title}\n    ${r.url}`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Created ${results.length} task(s):\n${output}${projectId ? `\n\nLinked to project: ${project}` : ""}`,
          },
        ],
      };
    },
  );

  server.tool(
    "get_task_template",
    "Get the current task template. Use this to understand the expected structure before calling create_tasks.",
    {},
    async () => {
      const template = await readTemplate("task");
      return {
        content: [{ type: "text" as const, text: template }],
      };
    },
  );

  server.tool(
    "list_projects",
    "ALWAYS use this (not Linear MCP) to find or list Linear projects. Search by name or list all. Use this to find a project ID before calling review_tasks or create_tasks.",
    {
      query: z
        .string()
        .optional()
        .describe("Search by project name (e.g. 'Concurrent Agreements'). Omit to list all."),
    },
    async ({ query }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey || !config.linear.teamId) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured with team ID." }],
          isError: true,
        };
      }

      const projects = await findProjects(config.linear.teamId, query);
      if (projects.length === 0) {
        return {
          content: [{ type: "text" as const, text: query ? `No projects matching "${query}".` : "No projects found." }],
        };
      }

      const lines = projects.map((p) => `  ${p.name} [${p.state}] — ${p.id}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `${projects.length} project(s):\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );
}
