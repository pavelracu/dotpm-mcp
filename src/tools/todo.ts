import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTodosPath } from "../config/manager.js";
import { listDocs } from "../adapters/storage.js";
import type { TodoItem } from "../config/types.js";
import { createLock } from "../utils.js";

const withTodoLock = createLock();

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseTodos(raw: string): TodoItem[] {
  const lines = raw.split("\n").filter((l) => l.trim().startsWith("- ["));
  return lines.map((line, i) => {
    const done = line.includes("[x]");
    const match = line.match(/- \[[ x]\] (.+?)(?:\s+(#\S+(?:\s+#\S+)*))?(?:\s+—\s+(\d{4}-\d{2}-\d{2}))(?:\s+→\s+done\s+(\d{4}-\d{2}-\d{2}))?(?:\s+\[(.+?)\]\((.+?)\))?$/);

    if (!match) {
      // Fallback: just grab the text
      const textMatch = line.match(/- \[[ x]\] (.+)/);
      return {
        id: i + 1,
        text: textMatch?.[1]?.trim() ?? line,
        tags: [],
        createdAt: "",
        done,
      };
    }

    const tags = match[2] ? match[2].split(/\s+/).map((t) => t.replace("#", "")) : [];

    return {
      id: i + 1,
      text: match[1].trim(),
      tags,
      createdAt: match[3] ?? "",
      done,
      completedAt: match[4],
      link: match[6],
    };
  });
}

function serializeTodos(todos: TodoItem[]): string {
  return todos
    .map((t) => {
      const check = t.done ? "x" : " ";
      const tags = t.tags.length > 0 ? ` ${t.tags.map((tg) => `#${tg}`).join(" ")}` : "";
      const created = t.createdAt ? ` — ${t.createdAt}` : "";
      const completed = t.completedAt ? ` → done ${t.completedAt}` : "";
      const link = t.link ? ` [output](${t.link})` : "";
      return `- [${check}] ${t.text}${tags}${created}${completed}${link}`;
    })
    .join("\n");
}

async function loadTodos(): Promise<TodoItem[]> {
  const path = getTodosPath();
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf-8");
  if (!raw.trim()) return [];
  return parseTodos(raw);
}

async function saveTodos(todos: TodoItem[]): Promise<void> {
  await writeFile(getTodosPath(), serializeTodos(todos) + "\n", "utf-8");
}

function nextTodoId(todos: TodoItem[]): number {
  if (todos.length === 0) return 1;
  return Math.max(...todos.map((t) => t.id)) + 1;
}

export function registerTodoTools(server: McpServer): void {
  server.tool(
    "add_todo",
    "Add a personal todo to your dotpm list (~/.dotpm/todos.md). Use this for YOUR action items — things you need to do, not tasks for the team. For team tasks in Linear, use create_tasks instead. Keep it short — you can elaborate when you process it later.",
    {
      text: z.string().describe("What needs to be done. Short description."),
      tags: z
        .array(z.string())
        .optional()
        .describe("Optional tags for categorization, e.g. ['linear', 'brief']"),
    },
    async ({ text, tags }) => {
      return withTodoLock(async () => {
        const todos = await loadTodos();
        const newTodo: TodoItem = {
          id: nextTodoId(todos),
          text,
          tags: tags ?? [],
          createdAt: today(),
          done: false,
        };
        todos.push(newTodo);
        await saveTodos(todos);

        return {
          content: [
            {
              type: "text" as const,
              text: `Added todo #${newTodo.id}: ${text}${tags?.length ? ` [${tags.join(", ")}]` : ""}`,
            },
          ],
        };
      });
    },
  );

  server.tool(
    "get_todos",
    "Get your open personal todos from dotpm (~/.dotpm/todos.md), enriched with related documents found in your docs folder. These are YOUR action items, not team tasks from Linear.",
    {
      include_done: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include completed items (default: false)"),
      tag: z
        .string()
        .optional()
        .describe("Filter by tag"),
    },
    async ({ include_done, tag }) => {
      const todos = await loadTodos();
      let filtered = include_done ? todos : todos.filter((t) => !t.done);
      if (tag) {
        filtered = filtered.filter((t) => t.tags.includes(tag));
      }

      if (filtered.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No open todos." }],
        };
      }

      // Get doc index once (cached 30s), match by filename only — no N+1 file reads
      const allDocs = await listDocs();

      const enriched = filtered.map((todo) => {
        const searchTerms = todo.text
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .slice(0, 3)
          .map((w) => w.toLowerCase());

        let relatedDocs: string[] = [];
        if (searchTerms.length > 0) {
          relatedDocs = allDocs
            .filter((doc) => {
              const name = doc.name.toLowerCase();
              return searchTerms.some((t) => name.includes(t));
            })
            .slice(0, 3)
            .map((d) => `  ${d.category}/${d.name}`);
        }

        const check = todo.done ? "x" : " ";
        const tags = todo.tags.length > 0 ? ` [${todo.tags.join(", ")}]` : "";
        const related = relatedDocs.length > 0 ? `\n  Related docs:\n${relatedDocs.map((d) => `    • ${d}`).join("\n")}` : "";
        return `#${todo.id} [${check}] ${todo.text}${tags} — ${todo.createdAt}${related}`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: enriched.join("\n\n"),
          },
        ],
      };
    },
  );

  server.tool(
    "complete_todo",
    "Mark a todo as done. Optionally link to the output (a doc path or Linear URL).",
    {
      todo_id: z.number().describe("The todo ID number (shown in get_todos)"),
      link: z
        .string()
        .optional()
        .describe("Optional link to the output — a file path or URL"),
    },
    async ({ todo_id, link }) => {
      return withTodoLock(async () => {
        const todos = await loadTodos();
        const todo = todos.find((t) => t.id === todo_id);

        if (!todo) {
          return {
            content: [{ type: "text" as const, text: `Todo #${todo_id} not found.` }],
            isError: true,
          };
        }

        todo.done = true;
        todo.completedAt = today();
        if (link) todo.link = link;

        await saveTodos(todos);

        return {
          content: [
            {
              type: "text" as const,
              text: `Completed todo #${todo_id}: ${todo.text}${link ? `\n  → ${link}` : ""}`,
            },
          ],
        };
      });
    },
  );
}
