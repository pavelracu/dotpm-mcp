# dotpm-mcp Roadmap

## Current: v0.1 — Foundation

What's built and working:

- **Todo system** — add, list, complete with doc enrichment
- **Doc management** — save, find, read, update with auto-categorization
- **Rules/memory** — persistent rules injected into every tool response
- **Brief pipeline** — write brief → save to docs → create Linear project
- **Task creation** — brief → Linear issues using task template
- **Task review** — cross-task consistency check (gaps, duplicates, unclear ACs)
- **Sprint tools** — sprint status, sprint planning with capacity math
- **Team tools** — roster config, per-person pulse metrics
- **Templates** — customizable brief and task templates
- **Prompts** — daily standup, process todo, review brief, full brief flow
- **Onboarding** — setup tool with progressive unlock (standalone → Linear → team)

## Next: v0.2 — Smarter Rules

### Tagged rules injection

Currently all rules are injected into every tool response. Works fine at <15 rules but won't scale.

**Change:** Tag rules with tool categories so only relevant rules are injected per tool.

```
- Do not add estimates [sprint, review, tasks]
- Simple English [brief, tasks, docs]
- No auto-assignment [tasks, sprint]
```

`review_tasks` only sees rules tagged `review`. `save_doc` only sees rules tagged `docs`. Untagged rules inject everywhere (backwards compatible).

**Why it matters:** Keeps token overhead minimal as the rules list grows. A user with 30 rules should only see 5-8 per tool call.

### Known limitation: free-form routing

When users type requests directly (not via prompts), Claude may use Linear MCP + its own analysis instead of dotpm's tools. This means rules don't get injected. Prompts solve this (they include a routing preamble), but free-form requests rely on tool descriptions alone — which Claude can ignore.

**Possible solutions:**
- MCP protocol support for "always-include" resources (priority annotations exist but clients may not respect them)
- A lightweight proxy that intercepts Linear MCP responses and appends rules
- Client-side configuration (when claude.ai supports per-MCP instructions)

### Known limitation: subagent routing (Claude Code only)

When Claude Code spawns subagents for parallel work, those agents don't inherit the dotpm routing preamble. They may:
- Read `~/.dotpm/config.json` directly and make raw curl calls to Linear API (leaking the API key)
- Use Bash (`grep`, `find`) instead of dotpm's `find_docs`/`read_doc` for document search
- Duplicate work that dotpm tools already handle

This is a Claude Code limitation — subagents are independent processes. In claude.ai (target platform), there are no subagents, so this doesn't apply.

**Mitigations applied:**
- `chmod 600` on config.json to restrict casual reads
- Aggressive tool descriptions ("ALWAYS use this, not Linear MCP")

**Future fix:** Config file encryption or OS keychain storage for API keys

## Future: v0.3+

- **GitHub integration** — PR creation, code review workflows
- **PostHog integration** — error tracking, experiment results in sprint context
- **Rule suggestions** — MCP detects when Claude's output violates conventions and suggests a new rule
- **Doc versioning** — track changes to briefs over time, diff between versions
- **Bulk operations** — update all tasks under a project in one call (status, template backfill)

## Phase 2: dotpm UI

The MCP is the backend API for a visual AI task manager:

- Task board with parallel Claude sessions
- Assign tasks to Claude, watch progress in real time
- Review outputs before they hit Linear
- Replace the "4 terminal tabs and I forgot what each was doing" problem
