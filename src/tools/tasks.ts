import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, readTemplate } from "../config/manager.js";
import { resolveProject, createIssue, findProjects, getWorkflowStates, bulkUpdateIssues, updateIssue, updateProject, getProject, resolveProjectStatusId, getProjectStatuses, getIssue, archiveIssue, archiveProject } from "../adapters/linear.js";
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
    "ALWAYS use this to get the task template structure before calling create_tasks. Returns the expected sections (What, Why, Out of Scope, AC, DoD). Shortcut for get_template('task').",
    {},
    async () => {
      const template = await readTemplate("task");
      return {
        content: [{ type: "text" as const, text: template }],
      };
    },
  );

  server.tool(
    "read_issue",
    "ALWAYS use this (not Linear MCP, not bash curl, not GraphQL) to read a Linear issue. Returns full description, status, assignee, priority, and project. Use before editing a task with update_issues.",
    {
      issue: z.string().describe("Issue identifier (e.g. 'AWS-516') or UUID"),
    },
    async ({ issue }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured." }],
          isError: true,
        };
      }

      const found = await getIssue(issue);
      if (!found) {
        return {
          content: [{ type: "text" as const, text: `Issue not found: "${issue}"` }],
          isError: true,
        };
      }

      const priority = ["None", "Urgent", "High", "Medium", "Low"][found.priority] ?? "None";
      let output = `# ${found.identifier}: ${found.title}\n`;
      output += `Status: ${found.state.name} | Priority: ${priority}`;
      output += found.assignee ? ` | Assignee: ${found.assignee.name}` : ` | Unassigned`;
      if (found.project) output += ` | Project: ${found.project.name}`;
      if (found.labels.nodes.length > 0) output += `\nLabels: ${found.labels.nodes.map((l) => l.name).join(", ")}`;
      output += `\nURL: ${found.url}`;
      output += `\n\n---\n\n${found.description ?? "(no description)"}`;

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  server.tool(
    "read_project",
    "ALWAYS use this (not Linear MCP, not bash curl, not GraphQL) to read a Linear project's brief/description. Returns full content, status, URL, and task count. Use before editing a project with update_project.",
    {
      project: z.string().describe("Linear project ID (UUID) or project name to find"),
    },
    async ({ project }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey || !config.linear.teamId) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured with team ID." }],
          isError: true,
        };
      }

      const resolved = await resolveProject(config.linear.teamId, project);
      if (!resolved) {
        return {
          content: [{ type: "text" as const, text: `Project not found: "${project}"` }],
          isError: true,
        };
      }

      let output = `# ${resolved.name}\n`;
      output += `Status: ${resolved.state} | URL: ${resolved.url}\n`;
      output += `Tasks: ${resolved.issues.nodes.length}\n`;

      if (resolved.description) {
        output += `\nSummary: ${resolved.description}\n`;
      }

      output += `\n---\n\n${resolved.content ?? "(no brief content)"}`;

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  server.tool(
    "delete_issue",
    "ALWAYS use this (not Linear MCP, not bash curl) to archive/delete a Linear issue. Removes it from active views. Accepts identifiers like 'AWS-516'.",
    {
      issue: z.string().describe("Issue identifier (e.g. 'AWS-516') or UUID"),
    },
    async ({ issue }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured." }],
          isError: true,
        };
      }

      // Resolve identifier to ID
      const found = await getIssue(issue);
      if (!found) {
        return {
          content: [{ type: "text" as const, text: `Issue not found: "${issue}"` }],
          isError: true,
        };
      }

      const result = await archiveIssue(found.id);
      return {
        content: [
          {
            type: "text" as const,
            text: result.success
              ? `Archived ${found.identifier}: ${found.title}`
              : `Failed to archive ${found.identifier}`,
          },
        ],
      };
    },
  );

  server.tool(
    "delete_project",
    "ALWAYS use this (not Linear MCP, not bash curl) to archive/delete a Linear project. Removes it from active views. Accepts project ID or name.",
    {
      project: z.string().describe("Linear project ID (UUID) or project name to find"),
    },
    async ({ project }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey || !config.linear.teamId) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured with team ID." }],
          isError: true,
        };
      }

      const resolved = await resolveProject(config.linear.teamId, project);
      if (!resolved) {
        return {
          content: [{ type: "text" as const, text: `Project not found: "${project}"` }],
          isError: true,
        };
      }

      const result = await archiveProject(resolved.id);
      return {
        content: [
          {
            type: "text" as const,
            text: result.success
              ? `Archived project "${resolved.name}"`
              : `Failed to archive project "${resolved.name}"`,
          },
        ],
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
    "ALWAYS use this (not Linear MCP) to update Linear issues — status, priority, title, description. Accepts issue identifiers (e.g. 'AWS-532') or IDs. Bulk status/priority updates work on multiple issues. Title/description updates work on a single issue only.",
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
      title: z
        .string()
        .optional()
        .describe("New title — only use with a single issue"),
      description: z
        .string()
        .optional()
        .describe("New description (markdown) — replaces the full issue description. Only use with a single issue."),
    },
    async ({ issues, status, priority, title, description }) => {
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

      // If title or description provided, use single-issue update path
      if (title || description) {
        if (valid.length > 1) {
          return {
            content: [{ type: "text" as const, text: "title/description updates only work with a single issue." }],
            isError: true,
          };
        }
        const updates: { stateId?: string; priority?: number; title?: string; description?: string } = {};
        if (stateId) updates.stateId = stateId;
        if (priority !== undefined) updates.priority = priority;
        if (title) updates.title = title;
        if (description) updates.description = description;

        const result = await updateIssue(valid[0].id, updates);
        let output = `Updated ${valid[0].identifier}: ${result.success ? "✓" : "✗"}`;
        if (title) output += `\n→ Title: ${title}`;
        if (description) output += `\n→ Description updated (${description.length} chars)`;
        if (status) output += `\n→ Status: ${status}`;
        if (priority !== undefined) output += `\n→ Priority: ${["None", "Urgent", "High", "Medium", "Low"][priority]}`;
        return { content: [{ type: "text" as const, text: output }] };
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

  server.tool(
    "update_project",
    "ALWAYS use this (not Linear MCP) to update a Linear project — change the brief/description, name, or status. Use this to push brief content to Linear after writing or editing a brief locally.",
    {
      project: z
        .string()
        .describe("Linear project ID (UUID) or project name to find"),
      name: z
        .string()
        .optional()
        .describe("New project name"),
      description: z
        .string()
        .optional()
        .describe("Short project summary (one-liner shown in project lists)"),
      content: z
        .string()
        .optional()
        .describe("Full project brief/description (markdown). This is the main body content of the project in Linear — use this for briefs."),
      status: z
        .string()
        .optional()
        .describe("New project status name — e.g. 'Idea', 'Discovery', 'Proposal', 'Ready', 'In Progress', 'Completed', 'Canceled'"),
    },
    async ({ project, name, description, content, status }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey || !config.linear.teamId) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured with team ID." }],
          isError: true,
        };
      }

      if (!name && !description && !content && !status) {
        return {
          content: [{ type: "text" as const, text: "Nothing to update — provide at least one of: name, description, content, status." }],
          isError: true,
        };
      }

      // Resolve project
      const resolved = await resolveProject(config.linear.teamId, project);
      if (!resolved) {
        return {
          content: [{ type: "text" as const, text: `Project not found: "${project}"` }],
          isError: true,
        };
      }

      // Resolve status name to ID if provided
      let statusId: string | undefined;
      if (status) {
        const resolved_status = await resolveProjectStatusId(status);
        if (!resolved_status) {
          const statuses = await getProjectStatuses();
          const available = statuses.map((s) => s.name).join(", ");
          return {
            content: [{ type: "text" as const, text: `Status "${status}" not found. Available: ${available}` }],
            isError: true,
          };
        }
        statusId = resolved_status;
      }

      const updates: { name?: string; description?: string; content?: string; statusId?: string } = {};
      if (name) updates.name = name;
      if (description) updates.description = description;
      if (content) updates.content = content;
      if (statusId) updates.statusId = statusId;

      const result = await updateProject(resolved.id, updates);

      let output = `Updated project "${resolved.name}": ${result.success ? "✓" : "✗"}`;
      if (name) output += `\n→ Name: ${name}`;
      if (description) output += `\n→ Description updated`;
      if (content) output += `\n→ Brief/content updated (${content.length} chars)`;
      if (status) output += `\n→ Status: ${status}`;
      output += `\n${result.url}`;

      return { content: [{ type: "text" as const, text: output }] };
    },
  );
}
