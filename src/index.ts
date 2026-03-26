#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { cache } from "./adapters/cache.js";

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);

process.on("exit", () => cache.destroy());
