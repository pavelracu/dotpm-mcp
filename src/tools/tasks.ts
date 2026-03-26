import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, readTemplate } from "../config/manager.js";
import { resolveProject, createIssue, findProjects, getWorkflowStates, bulkUpdateIssues } from "../adapters/linear.js";
import { readDoc } from "../adapters/storage.js";

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

      // Create all issues in parallel
      const results = await Promise.all(
        tasks.map((task) =>
          createIssue(
            config.linear!.teamId,
            task.title,
            task.description,
            projectId,
            task.priority,
          ),
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

  server.tool(
    "update_issues",
    "ALWAYS use this (not Linear MCP) to update Linear issues — move status, change priority, bulk updates. Accepts issue identifiers (e.g. 'AWS-532') or IDs. Resolves status names like 'Backlog', 'Todo', 'In Progress' automatically.",
    {
      issues: z
        .array(z.string())
        .describe("Issue identifiers (e.g. ['AWS-532', 'AWS-533']) or IDs"),
      status: z
        .string()
        .optional()
        .describe("New status name — e.g. 'Backlog', 'Todo', 'In Progress', 'Done'"),
      priority: z
        .number()
        .optional()
        .describe("New priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low"),
    },
    async ({ issues, status, priority }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey || !config.linear.teamId) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured with team ID." }],
          isError: true,
        };
      }

      // Resolve status name to state ID
      let stateId: string | undefined;
      if (status) {
        const states = await getWorkflowStates(config.linear.teamId);
        const match = states.find((s) => s.name.toLowerCase() === status.toLowerCase());
        if (!match) {
          const available = states.map((s) => s.name).join(", ");
          return {
            content: [{ type: "text" as const, text: `Status "${status}" not found. Available: ${available}` }],
            isError: true,
          };
        }
        stateId = match.id;
      }

      // Resolve identifiers to IDs — need to search for each
      const { gql } = await import("../adapters/linear.js");
      const resolved = await Promise.all(
        issues.map(async (ident) => {
          // If it looks like a UUID, use directly
          if (ident.match(/^[0-9a-f]{8}-/)) return { id: ident, identifier: ident };
          // Otherwise look up by identifier (e.g. AWS-532)
          const data = await gql<{ issueVcsBranchSearch: { id: string; identifier: string } | null }>(
            `query($term: String!) { issueVcsBranchSearch(branchName: $term) { id identifier } }`,
            { term: ident },
          );
          if (data.issueVcsBranchSearch) return data.issueVcsBranchSearch;
          // Try search by identifier filter
          const search = await gql<{ issues: { nodes: Array<{ id: string; identifier: string }> } }>(
            `query($ident: String!) {
              issues(filter: { identifier: { eq: $ident } }, first: 1) {
                nodes { id identifier }
              }
            }`,
            { ident },
          );
          return search.issues.nodes[0] ?? null;
        }),
      );

      const valid = resolved.filter((r): r is { id: string; identifier: string } => r !== null);
      const notFound = issues.filter((_, i) => !resolved[i]);

      if (valid.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No issues found for: ${issues.join(", ")}` }],
          isError: true,
        };
      }

      // Bulk update in parallel
      const results = await bulkUpdateIssues(
        valid.map((v) => ({ issueId: v.id, stateId, priority })),
      );

      const updated = results
        .map((r, i) => `  ${valid[i].identifier}: ${r.success ? "✓" : "✗"}`)
        .join("\n");

      let output = `Updated ${results.filter((r) => r.success).length}/${valid.length} issue(s):\n${updated}`;
      if (status) output += `\n→ Status: ${status}`;
      if (priority !== undefined) output += `\n→ Priority: ${["None", "Urgent", "High", "Medium", "Low"][priority]}`;
      if (notFound.length > 0) output += `\n\nNot found: ${notFound.join(", ")}`;

      return { content: [{ type: "text" as const, text: output }] };
    },
  );
}
