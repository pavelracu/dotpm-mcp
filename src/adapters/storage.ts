import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { getDocsDir, loadConfig } from "../config/manager.js";
import { DOC_CATEGORIES, CATEGORY_KEYWORDS, type DocCategory } from "../config/types.js";
import { cache } from "./cache.js";

const DOC_INDEX_TTL = 30_000; // 30s

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function categorize(title: string, content: string): DocCategory {
  const combined = `${title} ${content}`.toLowerCase();
  let best: DocCategory = "notes";
  let bestScore = 0;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.reduce((s, kw) => s + (combined.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = cat as DocCategory;
    }
  }
  return best;
}

export async function saveDoc(
  title: string,
  content: string,
  category?: DocCategory,
): Promise<{ path: string; category: DocCategory }> {
  const config = await loadConfig();
  const docsDir = getDocsDir(config);
  const cat = category ?? categorize(title, content);
  const dir = join(docsDir, cat);
  await mkdir(dir, { recursive: true });

  const slug = slugify(title);
  let filename = `${today()}_${slug}.md`;
  let filepath = join(dir, filename);

  // Avoid overwriting — append version suffix
  let version = 2;
  while (existsSync(filepath)) {
    filename = `${today()}_${slug}_v${version}.md`;
    filepath = join(dir, filename);
    version++;
  }

  await writeFile(filepath, content, "utf-8");
  cache.invalidatePrefix("doc-index:");
  return { path: filepath, category: cat };
}

export interface DocEntry {
  path: string;
  name: string;
  category: DocCategory;
  modifiedAt: Date;
}

async function listCategoryDocs(docsDir: string, category: DocCategory): Promise<DocEntry[]> {
  const dir = join(docsDir, category);
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  const entries: DocEntry[] = [];

  // Stat all files in parallel
  const stats = await Promise.all(
    files
      .filter((f) => f.endsWith(".md"))
      .map(async (f) => {
        const path = join(dir, f);
        const s = await stat(path);
        return { path, name: f, stat: s };
      }),
  );

  for (const { path, name, stat: s } of stats) {
    if (s.isFile()) {
      entries.push({ path, name, category, modifiedAt: s.mtime });
    }
  }

  return entries;
}

export async function listDocs(category?: DocCategory): Promise<DocEntry[]> {
  const config = await loadConfig();
  const docsDir = getDocsDir(config);
  const categories = category ? [category] : [...DOC_CATEGORIES];

  const cacheKey = `doc-index:${category ?? "all"}`;
  const cached = cache.get<DocEntry[]>(cacheKey);
  if (cached) return cached;

  // Search all categories in parallel
  const results = await Promise.all(categories.map((cat) => listCategoryDocs(docsDir, cat)));

  const all = results.flat().sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  cache.set(cacheKey, all, DOC_INDEX_TTL);
  return all;
}

export async function findDocs(query: string, category?: DocCategory): Promise<DocEntry[]> {
  const allDocs = await listDocs(category);
  const terms = query.toLowerCase().split(/\s+/);

  // First pass: filename match (fast)
  const filenameMatches = allDocs.filter((doc) => {
    const name = doc.name.toLowerCase();
    return terms.some((t) => name.includes(t));
  });

  // Second pass: content match in parallel (only for docs not already matched)
  const unmatched = allDocs.filter((d) => !filenameMatches.includes(d));
  const contentChecks = await Promise.all(
    unmatched.map(async (doc) => {
      try {
        const content = await readFile(doc.path, "utf-8");
        const lower = content.toLowerCase();
        const matches = terms.some((t) => lower.includes(t));
        return matches ? doc : null;
      } catch {
        return null;
      }
    }),
  );

  const contentMatches = contentChecks.filter((d): d is DocEntry => d !== null);
  return [...filenameMatches, ...contentMatches];
}

export async function readDoc(pathOrQuery: string): Promise<{ path: string; content: string } | null> {
  // If it looks like a path, read directly
  if (pathOrQuery.startsWith("/") || pathOrQuery.startsWith("~")) {
    const resolved = pathOrQuery.replace("~", (await import("node:os")).homedir());
    if (existsSync(resolved)) {
      const content = await readFile(resolved, "utf-8");
      return { path: resolved, content };
    }
    return null;
  }

  // Otherwise search by keyword
  const matches = await findDocs(pathOrQuery);
  if (matches.length === 0) return null;

  const best = matches[0];
  const content = await readFile(best.path, "utf-8");
  return { path: best.path, content };
}

export async function updateDoc(
  pathOrQuery: string,
  updates: { append?: string; replaceSection?: { heading: string; content: string } },
): Promise<{ path: string; success: boolean }> {
  const doc = await readDoc(pathOrQuery);
  if (!doc) return { path: pathOrQuery, success: false };

  let content = doc.content;

  if (updates.replaceSection) {
    const { heading, content: newContent } = updates.replaceSection;
    // Match ## Heading through to next ## or end of file
    const pattern = new RegExp(
      `(## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?)(?=\\n## |$)`,
    );
    if (pattern.test(content)) {
      content = content.replace(pattern, `## ${heading}\n${newContent}\n`);
    } else {
      // Section not found, append it
      content += `\n## ${heading}\n${newContent}\n`;
    }
  }

  if (updates.append) {
    content += `\n${updates.append}`;
  }

  await writeFile(doc.path, content, "utf-8");
  cache.invalidatePrefix("doc-index:");
  return { path: doc.path, success: true };
}
