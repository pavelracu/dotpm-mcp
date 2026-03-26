import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "../config/manager.js";
import { resolveProject, type LinearIssue } from "../adapters/linear.js";
import { readDoc } from "../adapters/storage.js";
import { getRulesContext, getRulesNudge } from "../config/rules.js";

interface ReviewFinding {
  type: "gap" | "duplicate" | "unclear" | "dependency" | "missing_section";
  severity: "high" | "medium" | "low";
  description: string;
  issues: string[]; // identifiers
}

function analyzeTaskConsistency(issues: LinearIssue[], briefContent?: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Check for missing template sections in each task
  const requiredSections = ["## 1. What", "## 2. Why", "## 3. Out of Scope", "## 4. Acceptance Criteria", "## 5. Definition of Done"];

  for (const issue of issues) {
    const desc = issue.description ?? "";
    const missing = requiredSections.filter((s) => !desc.includes(s));
    if (missing.length > 0) {
      findings.push({
        type: "missing_section",
        severity: missing.length > 2 ? "high" : "medium",
        description: `${issue.identifier} missing sections: ${missing.map((s) => s.replace("## ", "")).join(", ")}`,
        issues: [issue.identifier],
      });
    }

    // Check for empty acceptance criteria
    if (desc.includes("## 4. Acceptance Criteria") && !desc.match(/- \[[ x]\] .+/)) {
      findings.push({
        type: "unclear",
        severity: "high",
        description: `${issue.identifier} has Acceptance Criteria section but no checkboxes`,
        issues: [issue.identifier],
      });
    }
  }

  // Check for potential duplicates (similar titles)
  for (let i = 0; i < issues.length; i++) {
    for (let j = i + 1; j < issues.length; j++) {
      const a = issues[i].title.toLowerCase().split(/\s+/);
      const b = issues[j].title.toLowerCase().split(/\s+/);
      const overlap = a.filter((w) => w.length > 3 && b.includes(w));
      if (overlap.length >= 3) {
        findings.push({
          type: "duplicate",
          severity: "medium",
          description: `${issues[i].identifier} and ${issues[j].identifier} have similar titles (shared words: ${overlap.join(", ")})`,
          issues: [issues[i].identifier, issues[j].identifier],
        });
      }
    }
  }

  // Check brief coverage if we have the brief
  if (briefContent) {
    // Extract requirement lines from brief
    const reqMatch = briefContent.match(/### Must Have[\s\S]*?(?=###|## |$)/);
    if (reqMatch) {
      const reqLines = reqMatch[0]
        .split("\n")
        .filter((l) => l.trim().startsWith("-") && l.trim().length > 2)
        .map((l) => l.replace(/^-\s*/, "").trim());

      const allTaskText = issues.map((i) => `${i.title} ${i.description ?? ""}`).join(" ").toLowerCase();

      for (const req of reqLines) {
        const keywords = req.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
        const covered = keywords.some((kw) => allTaskText.includes(kw));
        if (!covered && keywords.length > 0) {
          findings.push({
            type: "gap",
            severity: "high",
            description: `Brief requirement may not be covered: "${req.slice(0, 80)}"`,
            issues: [],
          });
        }
      }
    }
  }

  return findings;
}

export function registerReviewTools(server: McpServer): void {
  server.tool(
    "review_tasks",
    "ALWAYS use this (not Linear MCP) when asked to check tasks, find inconsistencies, review a project, or audit task quality. Fetches all tasks from Linear, analyzes for gaps, duplicates, unclear ACs, missing template sections. Applies your saved rules. Accepts project ID or name.",
    {
      project: z.string().describe("Linear project ID (UUID) or project name to search for (e.g. 'Concurrent Agreements')"),
      brief_path: z
        .string()
        .optional()
        .describe("Path or keyword to find the brief — enables gap analysis against requirements"),
    },
    async ({ project, brief_path }) => {
      const config = await loadConfig();
      if (!config.linear?.apiKey || !config.linear.teamId) {
        return {
          content: [{ type: "text" as const, text: "Linear not configured. Run setup with API key and team ID." }],
          isError: true,
        };
      }

      // Resolve project by ID or name, and optionally fetch brief in parallel
      const [resolvedProject, brief] = await Promise.all([
        resolveProject(config.linear.teamId, project),
        brief_path ? readDoc(brief_path) : Promise.resolve(null),
      ]);

      if (!resolvedProject) {
        return {
          content: [{ type: "text" as const, text: `Project not found: "${project}"` }],
          isError: true,
        };
      }

      const projectData = resolvedProject;

      const issues = projectData.issues.nodes;
      if (issues.length === 0) {
        return {
          content: [{ type: "text" as const, text: `Project "${projectData.name}" has no tasks yet.` }],
        };
      }

      const findings = analyzeTaskConsistency(issues, brief?.content);

      // --- Build PM-oriented output: summary first, details second ---
      let output = `# Task Review: ${projectData.name}\n`;
      output += `Tasks: ${issues.length} | Findings: ${findings.length}\n`;
      output += `Brief: ${projectData.description ? "loaded" : "not found"}\n`;

      // Findings as a flat table — no walls of text
      if (findings.length === 0) {
        output += "\n✓ No issues found. Tasks look consistent.";
      } else {
        output += "\n## Findings\n| Severity | Type | Detail |\n|---|---|---|";
        for (const f of [...findings].sort((a, b) => {
          const order = { high: 0, medium: 1, low: 2 };
          return order[a.severity] - order[b.severity];
        })) {
          output += `\n| ${f.severity} | ${f.type} | ${f.description} |`;
        }
      }

      // Task list as compact table
      output += "\n\n## Tasks\n| ID | Title | Status |\n|---|---|---|";
      for (const issue of issues) {
        output += `\n| ${issue.identifier} | ${issue.title} | ${issue.state.name} |`;
      }

      // Brief summary — not the full text, just enough for context
      if (projectData.description) {
        // Extract first 500 chars as summary
        const briefSummary = projectData.description.slice(0, 500).replace(/\n/g, " ").trim();
        output += `\n\n## Brief Summary (full brief already loaded — do NOT offer to fetch it)\n${briefSummary}${projectData.description.length > 500 ? "..." : ""}`;
      }

      output += `\n\nINSTRUCTIONS: Present findings concisely. Use tables. Do NOT expand into lengthy analysis. The user is a PM — they need actionable items, not explanations. Do NOT offer to read the brief — it's already loaded above.`;

      // Inject rules so Claude follows conventions in its analysis
      const rules = await getRulesContext();
      if (rules) {
        output += `\n${rules}`;
      }
      output += getRulesNudge();

      return { content: [{ type: "text" as const, text: output }] };
    },
  );
}
