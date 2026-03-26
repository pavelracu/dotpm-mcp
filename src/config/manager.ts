import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DotpmConfig, TeamConfig } from "./types.js";
import { DEFAULT_CONFIG, DEFAULT_BRIEF_TEMPLATE, DEFAULT_TASK_TEMPLATE } from "./defaults.js";
import { DOC_CATEGORIES } from "./types.js";

const DOTPM_DIR = join(homedir(), ".dotpm");
const CONFIG_PATH = join(DOTPM_DIR, "config.json");
const TEAM_PATH = join(DOTPM_DIR, "team.json");
const TEMPLATES_DIR = join(DOTPM_DIR, "templates");
const TODOS_PATH = join(DOTPM_DIR, "todos.md");

let cachedConfig: DotpmConfig | null = null;
let cachedTeam: TeamConfig | null = null;
let configMtime = 0;
let teamMtime = 0;

export function getDotpmDir(): string {
  return DOTPM_DIR;
}

export function getDocsDir(config?: DotpmConfig): string {
  const path = config?.storage.docsPath ?? DEFAULT_CONFIG.storage.docsPath;
  return path.replace("~", homedir());
}

export function getTodosPath(): string {
  return TODOS_PATH;
}

export function getTemplatesDir(): string {
  return TEMPLATES_DIR;
}

export function isConfigured(): boolean {
  return existsSync(CONFIG_PATH);
}

export async function loadConfig(): Promise<DotpmConfig> {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error("NOT_CONFIGURED");
  }

  // Check if file changed since last cache
  const stat = statSync(CONFIG_PATH);
  const mtime = stat.mtimeMs;

  if (cachedConfig && mtime === configMtime) {
    return cachedConfig;
  }

  const raw = await readFile(CONFIG_PATH, "utf-8");
  cachedConfig = JSON.parse(raw) as DotpmConfig;
  configMtime = mtime;
  return cachedConfig;
}

export async function saveConfig(config: DotpmConfig): Promise<void> {
  await mkdir(DOTPM_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  cachedConfig = config;
  configMtime = statSync(CONFIG_PATH).mtimeMs;
}

export async function loadTeam(): Promise<TeamConfig | null> {
  if (!existsSync(TEAM_PATH)) return null;

  const stat = statSync(TEAM_PATH);
  const mtime = stat.mtimeMs;

  if (cachedTeam && mtime === teamMtime) {
    return cachedTeam;
  }

  const raw = await readFile(TEAM_PATH, "utf-8");
  cachedTeam = JSON.parse(raw) as TeamConfig;
  teamMtime = mtime;
  return cachedTeam;
}

export async function saveTeam(team: TeamConfig): Promise<void> {
  await writeFile(TEAM_PATH, JSON.stringify(team, null, 2), "utf-8");
  cachedTeam = team;
  teamMtime = statSync(TEAM_PATH).mtimeMs;
}

export async function initializeStorage(config: DotpmConfig): Promise<void> {
  const docsDir = getDocsDir(config);

  // Create all directories in parallel
  await Promise.all([
    mkdir(TEMPLATES_DIR, { recursive: true }),
    ...DOC_CATEGORIES.map((cat) => mkdir(join(docsDir, cat), { recursive: true })),
  ]);

  // Write default templates if they don't exist
  const briefPath = join(TEMPLATES_DIR, "brief.md");
  const taskPath = join(TEMPLATES_DIR, "task.md");

  const writes: Promise<void>[] = [];
  if (!existsSync(briefPath)) {
    writes.push(writeFile(briefPath, DEFAULT_BRIEF_TEMPLATE, "utf-8"));
  }
  if (!existsSync(taskPath)) {
    writes.push(writeFile(taskPath, DEFAULT_TASK_TEMPLATE, "utf-8"));
  }
  if (!existsSync(TODOS_PATH)) {
    writes.push(writeFile(TODOS_PATH, "", "utf-8"));
  }

  if (writes.length > 0) {
    await Promise.all(writes);
  }
}

export async function readTemplate(name: "brief" | "task"): Promise<string> {
  const path = join(TEMPLATES_DIR, `${name}.md`);
  if (!existsSync(path)) {
    return name === "brief" ? DEFAULT_BRIEF_TEMPLATE : DEFAULT_TASK_TEMPLATE;
  }
  return readFile(path, "utf-8");
}

export async function writeTemplate(name: "brief" | "task", content: string): Promise<void> {
  await mkdir(TEMPLATES_DIR, { recursive: true });
  await writeFile(join(TEMPLATES_DIR, `${name}.md`), content, "utf-8");
}

export function requireConfig(config: DotpmConfig | null): asserts config is DotpmConfig {
  if (!config) {
    throw new Error("NOT_CONFIGURED");
  }
}

export function requireLinear(config: DotpmConfig): void {
  if (!config.linear?.apiKey) {
    throw new Error("LINEAR_NOT_CONFIGURED");
  }
}
