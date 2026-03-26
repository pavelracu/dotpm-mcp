import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, loadTeam, saveTeam } from "../config/manager.js";
import { getTeamMembers, getCompletedIssues, getActiveCycle } from "../adapters/linear.js";
import type { TeamConfig, TeamMember } from "../config/types.js";

export function registerTeamTools(server: McpServer): void {
  server.tool(
    "configure_team",
    "Set up your team roster with roles, capabilities, and capacity constraints. Saved to ~/.dotpm/team.json.",
    {
      members: z
        .array(
          z.object({
            name: z.string().describe("Team member name"),
            role: z.string().describe("Role — e.g. 'Tech Lead', 'Full-Stack Developer'"),
            capabilities: z
              .array(z.string())
              .describe("What they can do — e.g. ['frontend', 'backend', 'architecture']"),
            constraints: z
              .array(z.string())
              .optional()
              .default([])
              .describe("Limitations — e.g. ['UI only, no logic', 'limited availability']"),
            sprintCapacity: z
              .string()
              .optional()
              .default("2-3 tasks")
              .describe("Realistic sprint capacity — e.g. '0-1 tasks', '2-3 tasks'"),
          }),
        )
        .describe("Team member list"),
      no_auto_assignment: z
        .boolean()
        .optional()
        .default(true)
        .describe("Prevent auto-assigning tasks (default: true — assignment is the tech lead's job)"),
    },
    async ({ members, no_auto_assignment }) => {
      const team: TeamConfig = {
        members: members as TeamMember[],
        conventions: {
          noAutoAssignment: no_auto_assignment,
        },
      };

      await saveTeam(team);

      const roster = members
        .map((m) => `  ${m.name} — ${m.role} (${m.sprintCapacity})`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Team configured (${members.length} members):\n${roster}\n\nAuto-assignment: ${no_auto_assignment ? "disabled" : "enabled"}`,
          },
        ],
      };
    },
  );

  server.tool(
    "team_pulse",
    "Get per-person performance data from Linear. Shows completion rate, cycle time, current load. Facts only, no characterizations.",
    {
      days: z
        .number()
        .optional()
        .default(30)
        .describe("Look-back period in days (default: 30)"),
    },
    async ({ days }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey || !config.linear.teamId) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured with team ID." }],
          isError: true,
        };
      }

      const teamId = config.linear.teamId;

      // Fetch completed issues, active cycle, and team members in parallel
      const [completed, cycle, members] = await Promise.all([
        getCompletedIssues(teamId, days),
        getActiveCycle(teamId),
        getTeamMembers(teamId),
      ]);

      const team = await loadTeam();

      // Per-person stats
      const stats = new Map<
        string,
        {
          completed: number;
          avgCycleTimeDays: number;
          currentLoad: number;
          currentInProgress: number;
        }
      >();

      // Completed tasks by person
      for (const issue of completed) {
        const name = issue.assignee?.name ?? "Unassigned";
        if (!stats.has(name)) {
          stats.set(name, { completed: 0, avgCycleTimeDays: 0, currentLoad: 0, currentInProgress: 0 });
        }
        const s = stats.get(name)!;
        s.completed++;

        if (issue.startedAt && issue.completedAt) {
          const cycleDays =
            (new Date(issue.completedAt).getTime() - new Date(issue.startedAt).getTime()) / 86400000;
          s.avgCycleTimeDays = (s.avgCycleTimeDays * (s.completed - 1) + cycleDays) / s.completed;
        }
      }

      // Current cycle load
      if (cycle) {
        for (const issue of cycle.issues.nodes) {
          const name = issue.assignee?.name ?? "Unassigned";
          if (!stats.has(name)) {
            stats.set(name, { completed: 0, avgCycleTimeDays: 0, currentLoad: 0, currentInProgress: 0 });
          }
          const s = stats.get(name)!;
          s.currentLoad++;
          if (issue.state.type === "started") {
            s.currentInProgress++;
          }
        }
      }

      let output = `# Team Pulse (last ${days} days)\n\n`;
      output += `| Person | Completed | Avg Cycle Time | Current Sprint | In Progress |\n`;
      output += `|---|---|---|---|---|\n`;

      for (const member of members) {
        const s = stats.get(member.name) ?? {
          completed: 0,
          avgCycleTimeDays: 0,
          currentLoad: 0,
          currentInProgress: 0,
        };
        const teamMember = team?.members.find((m) => m.name === member.name);
        const capacity = teamMember?.sprintCapacity ?? "—";

        output += `| ${member.name} | ${s.completed} | ${s.avgCycleTimeDays > 0 ? `${s.avgCycleTimeDays.toFixed(1)}d` : "—"} | ${s.currentLoad} (cap: ${capacity}) | ${s.currentInProgress} |\n`;
      }

      // Show unassigned if any
      const unassigned = stats.get("Unassigned");
      if (unassigned && unassigned.currentLoad > 0) {
        output += `\nUnassigned tasks in sprint: ${unassigned.currentLoad}`;
      }

      return { content: [{ type: "text" as const, text: output }] };
    },
  );
}
