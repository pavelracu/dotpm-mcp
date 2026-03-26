export interface DotpmConfig {
  version: number;
  linear?: {
    apiKey: string;
    teamId: string;
    teamName: string;
  };
  storage: {
    docsPath: string;
  };
  preferences: {
    language: "simple" | "standard";
    dateFormat: string;
  };
}

export interface TeamMember {
  name: string;
  role: string;
  capabilities: string[];
  constraints: string[];
  sprintCapacity: string; // e.g. "0-1 tasks", "2-3 tasks"
}

export interface TeamConfig {
  members: TeamMember[];
  conventions: {
    noAutoAssignment: boolean;
    estimateScale?: Record<string, string>;
  };
}

export interface TodoItem {
  id: number;
  text: string;
  tags: string[];
  createdAt: string;
  done: boolean;
  completedAt?: string;
  link?: string;
}

export const DOC_CATEGORIES = [
  "briefs",
  "research",
  "reports",
  "strategy",
  "people",
  "notes",
  "code",
] as const;

export type DocCategory = (typeof DOC_CATEGORIES)[number];

export const CATEGORY_KEYWORDS: Record<DocCategory, string[]> = {
  briefs: ["brief", "prd", "spec", "requirements", "feature spec", "product spec"],
  research: ["research", "comparison", "competitive", "deep dive", "market analysis", "evaluate"],
  reports: ["report", "analysis", "capacity", "sprint review", "metrics", "audit", "status"],
  strategy: ["strategy", "roadmap", "quarterly", "okr", "planning"],
  people: ["performance review", "1:1", "meeting prep", "hiring", "feedback", "onboarding"],
  code: ["template", "script", "code", "generate", "implementation", "config"],
  notes: [],
};
