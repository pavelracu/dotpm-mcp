import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config/manager.js";
import { getRulesContext, getRulesNudge } from "../config/rules.js";
import {
  getActiveCycle,
  getBacklog,
  getCompletedIssues,
  getTeamMembers,
  gqlAll,
  type LinearIssue,
} from "../adapters/linear.js";

function formatIssue(issue: LinearIssue): string {
  const assignee = issue.assignee?.name ?? "Unassigned";
  const priority = ["None", "Urgent", "High", "Medium", "Low"][issue.priority] ?? "None";
  return `  ${issue.identifier}: ${issue.title} [${issue.state.name}] → ${assignee} (${priority})`;
}

export function registerSprintTools(server: McpServer): void {
  server.tool(
    "sprint_status",
    "ALWAYS use this (not Linear MCP) for sprint status, sprint health, what's in the sprint, or how the team is doing. Fetches current cycle from Linear, shows issues by status, completion %, blockers, stale items, per-person workload. Applies your saved rules.",
    {},
    async () => {
      const config = await loadConfig();
      if (!config.linear?.apiKey) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured. Run setup with a Linear API key." }],
          isError: true,
        };
      }
      if (!config.linear.teamId) {
        return {
          content: [{ type: "text" as const, text: "Linear team ID not set. Run setup with linear_team_id." }],
          isError: true,
        };
      }

      const cycle = await getActiveCycle(config.linear.teamId);
      if (!cycle) {
        return {
          content: [{ type: "text" as const, text: "No active sprint/cycle found." }],
        };
      }

      const issues = cycle.issues.nodes;
      const total = issues.length;
      const done = issues.filter((i) => i.state.type === "completed").length;
      const inProgress = issues.filter((i) => i.state.type === "started").length;
      const todo = issues.filter((i) => ["unstarted", "backlog"].includes(i.state.type)).length;
      const canceled = issues.filter((i) => i.state.type === "cancelled").length;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;

      // Group by assignee
      const byAssignee = new Map<string, LinearIssue[]>();
      for (const issue of issues) {
        const name = issue.assignee?.name ?? "Unassigned";
        if (!byAssignee.has(name)) byAssignee.set(name, []);
        byAssignee.get(name)!.push(issue);
      }

      // Blocked/stale detection
      const staleThreshold = Date.now() - 7 * 86400000; // 7 days
      const stale = issues.filter(
        (i) =>
          i.state.type === "started" &&
          i.startedAt &&
          new Date(i.startedAt).getTime() < staleThreshold,
      );

      let output = `# Sprint: ${cycle.name ?? `Cycle ${cycle.number}`}
${cycle.startsAt.split("T")[0]} → ${cycle.endsAt.split("T")[0]}
Progress: ${pct}% (${done}/${total})

## Summary
| Status | Count |
|---|---|
| Done | ${done} |
| In Progress | ${inProgress} |
| Todo | ${todo} |
| Canceled | ${canceled} |

## By Person`;

      for (const [name, personIssues] of byAssignee) {
        const personDone = personIssues.filter((i) => i.state.type === "completed").length;
        const personTotal = personIssues.length;
        output += `\n\n### ${name} (${personDone}/${personTotal})`;
        for (const issue of personIssues) {
          output += `\n${formatIssue(issue)}`;
        }
      }

      if (stale.length > 0) {
        output += "\n\n## Stale (in progress >7 days)";
        for (const issue of stale) {
          const days = Math.round((Date.now() - new Date(issue.startedAt!).getTime()) / 86400000);
          output += `\n  ⚠ ${issue.identifier}: ${issue.title} — ${days} days (${issue.assignee?.name ?? "Unassigned"})`;
        }
      }

      const rules = await getRulesContext();
      if (rules) output += `\n${rules}`;
      output += getRulesNudge();
      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  server.tool(
    "plan_sprint",
    "Analyze backlog and recent velocity to recommend next sprint scope. Shows capacity per person and suggests what to include.",
    {
      sprint_days: z.number().optional().default(10).describe("Working days in sprint (default: 10)"),
      pto: z
        .array(z.object({
          name: z.string(),
          days: z.number(),
        }))
        .optional()
        .describe("PTO for team members, e.g. [{name: 'Honey', days: 3}]"),
    },
    async ({ sprint_days, pto }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey || !config.linear.teamId) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured with team ID." }],
          isError: true,
        };
      }

      const teamId = config.linear.teamId;

      // Fetch backlog, completed issues, and team members in parallel
      const [backlog, completed, members] = await gqlAll<
        [LinearIssue[], LinearIssue[], Array<{ id: string; name: string; email: string; active: boolean }>]
      >([
        {
          query: `query($teamId: String!) {
            issues(filter: { team: { id: { eq: $teamId } }, state: { type: { in: ["backlog", "unstarted"] } } }, first: 100) {
              nodes { id identifier title priority state { name type } assignee { id name } labels { nodes { name } } estimate url project { id name } }
            }
          }`,
          variables: { teamId },
        },
        {
          query: `query($teamId: String!, $since: DateTime!) {
            issues(filter: { team: { id: { eq: $teamId } }, state: { type: { eq: "completed" } }, completedAt: { gte: $since } }, first: 200) {
              nodes { id identifier title assignee { id name } completedAt startedAt estimate }
            }
          }`,
          variables: { teamId, since: new Date(Date.now() - 30 * 86400000).toISOString() },
        },
        {
          query: `query($teamId: String!) { team(id: $teamId) { members { nodes { id name email active } } } }`,
          variables: { teamId },
        },
      ]);

      // The gqlAll returns raw GraphQL data, extract the arrays
      const backlogIssues = (backlog as unknown as { issues: { nodes: LinearIssue[] } }).issues.nodes;
      const completedIssues = (completed as unknown as { issues: { nodes: LinearIssue[] } }).issues.nodes;
      const teamMembers = (members as unknown as { team: { members: { nodes: Array<{ id: string; name: string; active: boolean }> } } }).team.members.nodes.filter((m) => m.active);

      // Calculate throughput per person (last 30 days → per sprint)
      const throughput = new Map<string, number>();
      for (const issue of completedIssues) {
        const name = issue.assignee?.name ?? "Unassigned";
        throughput.set(name, (throughput.get(name) ?? 0) + 1);
      }

      // Normalize to sprint duration (30 days → sprint_days)
      const ratio = sprint_days / 20; // 20 working days in 30 calendar days (approx)
      const ptoMap = new Map<string, number>();
      for (const p of pto ?? []) {
        ptoMap.set(p.name, p.days);
      }

      let output = `# Sprint Planning\nSprint duration: ${sprint_days} working days\n\n## Team Capacity\n\n| Person | Last 30d Tasks | Sprint Capacity | PTO | Adjusted Capacity |\n|---|---|---|---|---|`;

      let totalCapacity = 0;
      for (const member of teamMembers) {
        const last30 = throughput.get(member.name) ?? 0;
        const raw = Math.round(last30 * ratio);
        const ptoDays = ptoMap.get(member.name) ?? 0;
        const adjusted = Math.max(0, Math.round(raw * ((sprint_days - ptoDays) / sprint_days)));
        totalCapacity += adjusted;
        output += `\n| ${member.name} | ${last30} | ${raw} | ${ptoDays}d | ${adjusted} |`;
      }

      output += `\n\n**Total team capacity: ~${totalCapacity} tasks**`;

      // Sort backlog by priority
      const sorted = [...backlogIssues].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      output += `\n\n## Backlog (${sorted.length} items, by priority)\n`;
      const recommended = sorted.slice(0, totalCapacity);
      const overflow = sorted.slice(totalCapacity);

      if (recommended.length > 0) {
        output += "\n### Recommended for sprint";
        for (const issue of recommended) {
          const p = ["None", "Urgent", "High", "Medium", "Low"][issue.priority] ?? "None";
          const proj = issue.project ? ` [${issue.project.name}]` : "";
          output += `\n  ${issue.identifier}: ${issue.title} (${p})${proj}`;
        }
      }

      if (overflow.length > 0) {
        output += `\n\n### Remaining backlog (${overflow.length} items)`;
        for (const issue of overflow.slice(0, 10)) {
          output += `\n  ${issue.identifier}: ${issue.title}`;
        }
        if (overflow.length > 10) {
          output += `\n  ... and ${overflow.length - 10} more`;
        }
      }

      const planRules = await getRulesContext();
      if (planRules) output += `\n${planRules}`;
      output += getRulesNudge();
      return { content: [{ type: "text" as const, text: output }] };
    },
  );
}
