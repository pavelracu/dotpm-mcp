import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDotpmDir } from "./manager.js";
import { createLock } from "../utils.js";

const RULES_PATH = join(getDotpmDir(), "rules.md");

const withRulesLock = createLock();

let cachedRules: string | null = null;
let rulesMtime = 0;

/**
 * Rules are loaded and injected into every tool response and prompt.
 * They encode workflow conventions that Claude must follow.
 * Unlike resources (opt-in), rules are always present.
 */
export async function loadRules(): Promise<string> {
  const path = RULES_PATH;
  if (!existsSync(path)) return "";

  const stat = statSync(path);
  if (cachedRules && stat.mtimeMs === rulesMtime) {
    return cachedRules;
  }

  cachedRules = await readFile(path, "utf-8");
  rulesMtime = stat.mtimeMs;
  return cachedRules;
}

export async function saveRules(content: string): Promise<void> {
  await mkdir(getDotpmDir(), { recursive: true });
  const path = RULES_PATH;
  await writeFile(path, content, "utf-8");
  cachedRules = content;
  rulesMtime = statSync(path).mtimeMs;
}

export async function addRule(rule: string): Promise<string> {
  return withRulesLock(async () => {
    const current = await loadRules();
    const lines = current.split("\n").filter((l) => l.trim());
    // Avoid duplicates
    if (lines.some((l) => l.includes(rule))) {
      return current;
    }
    lines.push(`- ${rule}`);
    const updated = lines.join("\n") + "\n";
    await saveRules(updated);
    return updated;
  });
}

export async function removeRule(keyword: string): Promise<{ removed: boolean; rule?: string }> {
  return withRulesLock(async () => {
    const current = await loadRules();
    const lines = current.split("\n").filter((l) => l.trim());
    const idx = lines.findIndex((l) => l.toLowerCase().includes(keyword.toLowerCase()));
    if (idx === -1) return { removed: false };

    const removed = lines.splice(idx, 1)[0];
    await saveRules(lines.join("\n") + "\n");
    return { removed: true, rule: removed };
  });
}

/**
 * Returns rules formatted for injection into tool responses.
 * Empty string if no rules configured.
 */
export async function getRulesContext(): Promise<string> {
  const rules = await loadRules();
  if (!rules.trim()) return "";
  return `\n---\n⚙ Active rules (follow these strictly):\n${rules}---\n`;
}

/**
 * One-line nudge appended after tool outputs that generate recommendations.
 * Teaches users the 'remember' tool exists at the moment they'd need it.
 */
export function getRulesNudge(): string {
  return `\n💡 Something off? Use "add_rule" to change tool behavior (e.g. add_rule("Do not suggest X")).`;
}

export const DEFAULT_RULES = `- Do not add estimates to tasks. Estimates are the team's responsibility, not the product manager's. Only include estimates if explicitly asked.
- Do not assign tasks to specific people. Task assignment is the tech lead's responsibility.
- Write all task descriptions and docs in simple English. Short sentences, concrete examples, tables over paragraphs.
- Briefs are Linear projects, not issues. Use project status "Idea" for new briefs.
- Do not suggest milestones, labels, or organizational structures unless the user asks for them.
- Do not prescribe technical solutions. Define what and why. The tech lead decides how.
- When reviewing tasks, focus on: missing template sections, unclear acceptance criteria, gaps in brief coverage, and duplicates. Do not flag missing estimates or assignments.
- Flag technical findings in reviews but do NOT write them into briefs, tasks, or acceptance criteria. Technical decisions are the tech lead's output after discovery.
- Lead with the simple story. Match analysis depth to what's needed for product decisions, not exhaustive technical detail.
`;
