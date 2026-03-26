import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DOC_CATEGORIES, type DocCategory } from "../config/types.js";
import {
  saveDoc as storageSaveDoc,
  findDocs as storageFindDocs,
  readDoc as storageReadDoc,
  updateDoc as storageUpdateDoc,
  deleteDoc as storageDeleteDoc,
  listDocs,
} from "../adapters/storage.js";

export function registerDocTools(server: McpServer): void {
  server.tool(
    "save_doc",
    "ALWAYS use this (not Write tool, not bash echo/cat) to save documents to the docs folder (~/.dotpm/docs/). Auto-categorizes into briefs/research/reports/strategy/people/notes/code. Uses YYYY-MM-DD_slug.md naming. Handles versioning automatically.",
    {
      title: z.string().describe("Document title — used for filename and categorization"),
      content: z.string().describe("Markdown content of the document"),
      category: z
        .enum(DOC_CATEGORIES)
        .optional()
        .describe("Override auto-categorization. Options: briefs, research, reports, strategy, people, notes, code"),
    },
    async ({ title, content, category }) => {
      const result = await storageSaveDoc(title, content, category as DocCategory | undefined);
      return {
        content: [
          {
            type: "text" as const,
            text: `Saved to ${result.category}/${result.path.split("/").pop()}\nFull path: ${result.path}`,
          },
        ],
      };
    },
  );

  server.tool(
    "find_docs",
    "ALWAYS use this (not grep, not Glob, not bash find) to search for saved documents by keyword. Searches filenames first, then content. Returns matching docs across all categories.",
    {
      query: z.string().describe("Search keywords"),
      category: z
        .enum(DOC_CATEGORIES)
        .optional()
        .describe("Limit search to a specific category"),
      limit: z.number().optional().default(10).describe("Max results (default: 10)"),
    },
    async ({ query, category, limit }) => {
      const results = await storageFindDocs(query, category as DocCategory | undefined);
      const limited = results.slice(0, limit);

      if (limited.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No documents found for "${query}".` }],
        };
      }

      const lines = limited.map(
        (d) =>
          `• ${d.category}/${d.name} — ${d.modifiedAt.toISOString().split("T")[0]}`,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${results.length} doc(s)${results.length > limit ? ` (showing ${limit})` : ""}:\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );

  server.tool(
    "read_doc",
    "ALWAYS use this (not Read tool, not cat, not bash) to read a dotpm document. Accepts a file path or keyword — if keyword, returns the best match from the docs folder.",
    {
      path_or_query: z
        .string()
        .describe("Full file path, or keywords to find the document"),
    },
    async ({ path_or_query }) => {
      const result = await storageReadDoc(path_or_query);
      if (!result) {
        return {
          content: [
            { type: "text" as const, text: `No document found for "${path_or_query}".` },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `--- ${result.path} ---\n\n${result.content}`,
          },
        ],
      };
    },
  );

  server.tool(
    "update_doc",
    "ALWAYS use this (not Edit tool, not sed, not bash) to update a dotpm document. Append content or replace a specific section by ## heading. Accepts file path or keyword.",
    {
      path_or_query: z
        .string()
        .describe("Full file path or keywords to find the document"),
      append: z
        .string()
        .optional()
        .describe("Content to append at the end of the document"),
      replace_section_heading: z
        .string()
        .optional()
        .describe("The ## heading of the section to replace"),
      replace_section_content: z
        .string()
        .optional()
        .describe("New content for the section (used with replace_section_heading)"),
    },
    async ({ path_or_query, append, replace_section_heading, replace_section_content }) => {
      const updates: {
        append?: string;
        replaceSection?: { heading: string; content: string };
      } = {};

      if (append) updates.append = append;
      if (replace_section_heading && replace_section_content) {
        updates.replaceSection = {
          heading: replace_section_heading,
          content: replace_section_content,
        };
      }

      if (!updates.append && !updates.replaceSection) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Provide either 'append' or both 'replace_section_heading' and 'replace_section_content'.",
            },
          ],
          isError: true,
        };
      }

      const result = await storageUpdateDoc(path_or_query, updates);
      if (!result.success) {
        return {
          content: [
            { type: "text" as const, text: `Document not found: "${path_or_query}"` },
          ],
          isError: true,
        };
      }

      return {
        content: [
          { type: "text" as const, text: `Updated: ${result.path}` },
        ],
      };
    },
  );

  server.tool(
    "list_docs",
    "ALWAYS use this (not ls, not Glob, not bash) to list dotpm documents. Optionally filter by category (briefs/research/reports/strategy/people/notes/code). Shows most recent first.",
    {
      category: z
        .enum(DOC_CATEGORIES)
        .optional()
        .describe("Filter by category"),
      limit: z.number().optional().default(20).describe("Max results (default: 20)"),
    },
    async ({ category, limit }) => {
      const docs = await listDocs(category as DocCategory | undefined);
      const limited = docs.slice(0, limit);

      if (limited.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No documents saved yet." }],
        };
      }

      const lines = limited.map(
        (d) =>
          `• ${d.category}/${d.name} — ${d.modifiedAt.toISOString().split("T")[0]}`,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `${docs.length} doc(s)${docs.length > limit ? ` (showing ${limit})` : ""}:\n${lines.join("\n")}`,
          },
        ],
      };
    },
  );

  server.tool(
    "delete_doc",
    "ALWAYS use this (not rm, not bash) to delete a dotpm document. Accepts file path or keyword search. Cleans up the index cache.",
    {
      path_or_query: z
        .string()
        .describe("Full file path, or keywords to find the document to delete"),
    },
    async ({ path_or_query }) => {
      const result = await storageDeleteDoc(path_or_query);
      if (!result.success) {
        return {
          content: [
            { type: "text" as const, text: `Document not found: "${path_or_query}"` },
          ],
          isError: true,
        };
      }

      return {
        content: [
          { type: "text" as const, text: `Deleted: ${result.path}` },
        ],
      };
    },
  );
}
