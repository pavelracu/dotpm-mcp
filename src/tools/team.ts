import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, loadTeam, saveTeam } from "../config/manager.js";
import { getTeamMembers, getCompletedIssues, getActiveCycle } from "../adapters/linear.js";
import type { TeamConfig, TeamMember } from "../config/types.js";

export function registerTeamTools(server: McpServer): void {
  server.tool(
    "read_team",
    "ALWAYS use this (not bash cat, not Read tool on team.json) to view the team roster. Shows names, roles, capabilities, constraints, and sprint capacity. Use before configure_team to see what's already set.",
    {},
    async () => {
      const team = await loadTeam();
      if (!team || team.members.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No team configured. Use configure_team to set up your roster." }],
        };
      }

      let output = `# Team Roster (${team.members.length} members)\n\n`;
      output += `| Name | Role | Capabilities | Constraints | Sprint Capacity |\n`;
      output += `|---|---|---|---|---|\n`;

      for (const m of team.members) {
        const caps = m.capabilities.join(", ");
        const constraints = m.constraints?.length ? m.constraints.join(", ") : "—";
        output += `| ${m.name} | ${m.role} | ${caps} | ${constraints} | ${m.sprintCapacity ?? "—"} |\n`;
      }

      output += `\nAuto-assignment: ${team.conventions?.noAutoAssignment ? "disabled" : "enabled"}`;

      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  server.tool(
    "configure_team",
    "ALWAYS use this (not Write tool, not bash) to set up or update the team roster. Defines roles, capabilities, constraints, and capacity. Saved to ~/.dotpm/team.json. Also used to update — replaces the full roster.",
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
    "ALWAYS use this (not Linear MCP, not bash curl) for per-person performance data. Shows completion rate, avg cycle time, current sprint load. Use when asked 'how is the team doing', 'who is overloaded', or 'team performance'.",
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
