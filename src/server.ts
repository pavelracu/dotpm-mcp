import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Tools
import { registerSetupTools } from "./tools/setup.js";
import { registerTodoTools } from "./tools/todo.js";
import { registerDocTools } from "./tools/docs.js";
import { registerTemplateTools } from "./tools/template.js";
import { registerBriefTools } from "./tools/brief.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerReviewTools } from "./tools/review.js";
import { registerSprintTools } from "./tools/sprint.js";
import { registerTeamTools } from "./tools/team.js";
import { registerMemoryTools } from "./tools/memory.js";

// Prompts
import { registerDailyStandupPrompt } from "./prompts/daily-standup.js";
import { registerProcessTodoPrompt } from "./prompts/process-todo.js";
import { registerReviewBriefPrompt } from "./prompts/review-brief.js";
import { registerFullBriefFlowPrompt } from "./prompts/full-brief-flow.js";

// Resources
import { registerTeamRosterResource } from "./resources/team-roster.js";
import { registerTemplateResources } from "./resources/templates.js";
import { registerConventionResources } from "./resources/conventions.js";
import { registerRulesResource } from "./resources/rules.js";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "dotpm",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: { listChanged: false },
        prompts: { listChanged: false },
        resources: {},
      },
    },
  );

  // Register everything
  registerSetupTools(server);
  registerTodoTools(server);
  registerDocTools(server);
  registerTemplateTools(server);
  registerBriefTools(server);
  registerTaskTools(server);
  registerReviewTools(server);
  registerSprintTools(server);
  registerTeamTools(server);
  registerMemoryTools(server);

  registerDailyStandupPrompt(server);
  registerProcessTodoPrompt(server);
  registerReviewBriefPrompt(server);
  registerFullBriefFlowPrompt(server);

  registerTeamRosterResource(server);
  registerTemplateResources(server);
  registerConventionResources(server);
  registerRulesResource(server);

  return server;
}
