import type { DotpmConfig } from "./types.js";

export const DEFAULT_CONFIG: DotpmConfig = {
  version: 1,
  storage: {
    docsPath: "~/.dotpm/docs",
  },
  preferences: {
    language: "simple",
    dateFormat: "YYYY-MM-DD",
  },
};

export const DEFAULT_BRIEF_TEMPLATE = `## Problem Statement
What's broken or missing, who it affects, what's the cost of not solving it.

## Proposed Solution
What we're building and how it works. Keep it concrete.

## Requirements

### Must Have (P0)
-

### Should Have (P1)
-

### Could Have (P2)
-

### Won't Have (this time)
-

## Acceptance Criteria
- [ ]

## Open Questions
-
`;

export const DEFAULT_TASK_TEMPLATE = `## Design References
(Figma links — only for frontend tasks. Remove this section for backend tasks.)

## 1. What
What needs to be built. Name the component, page, API, or flow.

## 2. Why
Link to the parent project. What breaks if we don't do this.

## 3. Out of Scope
- What this task does NOT cover
- Reference related task IDs

## 4. Acceptance Criteria
- [ ] Clear, testable statement
- [ ] Another criterion

## 5. Definition of Done

**Frontend:**
| Item | Status |
|---|---|
| Description | ❌ |

**Backend:**
| Item | Status |
|---|---|
| Description | ❌ |

## Notes / Risks
- Open questions, dependencies, known risks
`;

export const WRITING_CONVENTIONS = {
  simple: {
    description: "Simple English — short sentences, concrete examples, tables over paragraphs",
    rules: [
      "Short sentences. One idea per sentence.",
      "No jargon when a plain word works.",
      "Use concrete examples instead of abstract descriptions.",
      "Tables over paragraphs.",
      "Code snippets over verbal explanations of data structures.",
    ],
  },
  standard: {
    description: "Standard English — professional but clear",
    rules: [
      "Clear, professional language.",
      "Use industry-standard terminology.",
      "Balance detail with readability.",
    ],
  },
};

export const LINEAR_CONVENTIONS = {
  projectStatuses: ["Idea", "Discovery", "Proposal", "Ready", "In Progress", "Completed", "Canceled"],
  briefIsProject: true,
  noAutoAssignment: true,
  noEstimatesUnlessAsked: true,
};
