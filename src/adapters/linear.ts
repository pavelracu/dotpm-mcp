import { loadConfig } from "../config/manager.js";
import { cache } from "./cache.js";

const LINEAR_API = "https://api.linear.app/graphql";
const CACHE_TTL = 60_000; // 60s for Linear data

let apiKey: string | null = null;

async function getApiKey(): Promise<string> {
  if (apiKey) return apiKey;
  const config = await loadConfig();
  if (!config.linear?.apiKey) throw new Error("LINEAR_NOT_CONFIGURED");
  apiKey = config.linear.apiKey;
  return apiKey;
}

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const key = await getApiKey();
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: key,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`);
  }
  return json.data as T;
}

/** Run multiple GraphQL queries in parallel */
export async function gqlAll<T extends unknown[]>(
  queries: Array<{ query: string; variables?: Record<string, unknown> }>,
): Promise<T> {
  const results = await Promise.all(queries.map((q) => gql(q.query, q.variables)));
  return results as T;
}

export async function testConnection(): Promise<{ success: boolean; userName?: string; error?: string }> {
  try {
    const data = await gql<{ viewer: { name: string } }>(`{ viewer { name } }`);
    return { success: true, userName: data.viewer.name };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- Team ---

interface LinearUser {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

export async function getTeamMembers(teamId: string): Promise<LinearUser[]> {
  const cacheKey = `linear:team:${teamId}:members`;
  const cached = cache.get<LinearUser[]>(cacheKey);
  if (cached) return cached;

  const data = await gql<{ team: { members: { nodes: LinearUser[] } } }>(
    `query($teamId: ID!) { team(id: $teamId) { members { nodes { id name email active } } } }`,
    { teamId },
  );
  const members = data.team.members.nodes.filter((m) => m.active);
  cache.set(cacheKey, members, CACHE_TTL);
  return members;
}

// --- Cycles ---

interface LinearCycle {
  id: string;
  name: string;
  number: number;
  startsAt: string;
  endsAt: string;
  progress: number;
  issues: {
    nodes: LinearIssue[];
  };
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  state: { name: string; type: string };
  assignee?: { id: string; name: string };
  labels: { nodes: Array<{ name: string }> };
  createdAt: string;
  completedAt?: string;
  startedAt?: string;
  estimate?: number;
  url: string;
  project?: { id: string; name: string };
}

export async function getActiveCycle(teamId: string): Promise<LinearCycle | null> {
  const cacheKey = `linear:team:${teamId}:active-cycle`;
  const cached = cache.get<LinearCycle | null>(cacheKey);
  if (cached !== undefined) return cached;

  const data = await gql<{ team: { activeCycle: LinearCycle | null } }>(
    `query($teamId: ID!) {
      team(id: $teamId) {
        activeCycle {
          id name number startsAt endsAt progress
          issues {
            nodes {
              id identifier title description priority
              state { name type }
              assignee { id name }
              labels { nodes { name } }
              createdAt completedAt startedAt estimate url
              project { id name }
            }
          }
        }
      }
    }`,
    { teamId },
  );

  cache.set(cacheKey, data.team.activeCycle, CACHE_TTL);
  return data.team.activeCycle;
}

// --- Projects ---

interface LinearProject {
  id: string;
  name: string;
  description?: string;
  state: string;
  url: string;
  issues: { nodes: LinearIssue[] };
}

export async function createProject(
  teamId: string,
  name: string,
  description: string,
  status: string = "planned",
): Promise<{ id: string; url: string }> {
  const data = await gql<{
    projectCreate: { success: boolean; project: { id: string; url: string } };
  }>(
    `mutation($input: ProjectCreateInput!) {
      projectCreate(input: $input) {
        success
        project { id url }
      }
    }`,
    {
      input: {
        name,
        description,
        state: status,
        teamIds: [teamId],
      },
    },
  );

  cache.invalidatePrefix("linear:");
  return data.projectCreate.project;
}

export async function findProjects(teamId: string, query?: string): Promise<Array<{ id: string; name: string; state: string; url: string }>> {
  const cacheKey = `linear:team:${teamId}:projects:${query ?? "all"}`;
  const cached = cache.get<Array<{ id: string; name: string; state: string; url: string }>>(cacheKey);
  if (cached) return cached;

  const data = await gql<{ projects: { nodes: Array<{ id: string; name: string; state: string; url: string }> } }>(
    `query($teamId: ID!) {
      projects(filter: { accessibleTeams: { id: { eq: $teamId } } }, first: 50) {
        nodes { id name state url }
      }
    }`,
    { teamId },
  );

  let results = data.projects.nodes;
  if (query) {
    const q = query.toLowerCase();
    results = results.filter((p) => p.name.toLowerCase().includes(q));
  }

  cache.set(cacheKey, results, CACHE_TTL);
  return results;
}

/** Resolve a project by ID or name search. Returns null if not found. */
export async function resolveProject(teamId: string, idOrName: string): Promise<LinearProject | null> {
  // If it looks like a UUID, fetch directly
  if (idOrName.match(/^[0-9a-f]{8}-[0-9a-f]{4}-/)) {
    return getProject(idOrName);
  }
  // Otherwise search by name
  const matches = await findProjects(teamId, idOrName);
  if (matches.length === 0) return null;
  // Get full project with issues
  return getProject(matches[0].id);
}

export async function getProject(projectId: string): Promise<LinearProject | null> {
  const cacheKey = `linear:project:${projectId}`;
  const cached = cache.get<LinearProject>(cacheKey);
  if (cached) return cached;

  const data = await gql<{ project: LinearProject }>(
    `query($id: ID!) {
      project(id: $id) {
        id name description state url
        issues {
          nodes {
            id identifier title description priority
            state { name type }
            assignee { id name }
            labels { nodes { name } }
            createdAt completedAt startedAt estimate url
            project { id name }
          }
        }
      }
    }`,
    { id: projectId },
  );

  cache.set(cacheKey, data.project, CACHE_TTL);
  return data.project;
}

// --- Issues ---

export async function createIssue(
  teamId: string,
  title: string,
  description: string,
  projectId?: string,
  priority?: number,
): Promise<{ id: string; identifier: string; url: string }> {
  const input: Record<string, unknown> = {
    teamId,
    title,
    description,
  };
  if (projectId) input.projectId = projectId;
  if (priority !== undefined) input.priority = priority;

  const data = await gql<{
    issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } };
  }>(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
    { input },
  );

  cache.invalidatePrefix("linear:");
  return data.issueCreate.issue;
}

export async function getBacklog(teamId: string): Promise<LinearIssue[]> {
  const cacheKey = `linear:team:${teamId}:backlog`;
  const cached = cache.get<LinearIssue[]>(cacheKey);
  if (cached) return cached;

  const data = await gql<{ issues: { nodes: LinearIssue[] } }>(
    `query($teamId: ID!) {
      issues(filter: {
        team: { id: { eq: $teamId } }
        state: { type: { in: ["backlog", "unstarted"] } }
      }, first: 100) {
        nodes {
          id identifier title description priority
          state { name type }
          assignee { id name }
          labels { nodes { name } }
          createdAt estimate url
          project { id name }
        }
      }
    }`,
    { teamId },
  );

  cache.set(cacheKey, data.issues.nodes, CACHE_TTL);
  return data.issues.nodes;
}

export async function getCompletedIssues(
  teamId: string,
  sinceDaysAgo: number = 30,
): Promise<LinearIssue[]> {
  const since = new Date(Date.now() - sinceDaysAgo * 86400000).toISOString();

  const data = await gql<{ issues: { nodes: LinearIssue[] } }>(
    `query($teamId: ID!, $since: DateTime!) {
      issues(filter: {
        team: { id: { eq: $teamId } }
        state: { type: { eq: "completed" } }
        completedAt: { gte: $since }
      }, first: 200) {
        nodes {
          id identifier title
          assignee { id name }
          createdAt completedAt startedAt estimate
          state { name type }
          labels { nodes { name } }
          url
        }
      }
    }`,
    { teamId, since },
  );

  return data.issues.nodes;
}

/** Reset the cached API key (e.g. after config update) */
export function resetLinearClient(): void {
  apiKey = null;
  cache.invalidatePrefix("linear:");
}
