import { McpServer } from "@modelcontextprotocol/server";
import type { Config } from "./config.ts";
import { createLinearClient } from "./linear.ts";
import { buildSchemaIndex } from "./schema-index.ts";
import { registerExecuteTool } from "./tools/execute.ts";
import { registerSchemaTool } from "./tools/schema.ts";
import { stringifyResponse, truncateResponse } from "./truncate.ts";

export const SERVER_INFO = { name: "linear-codemode-mcp", version: "0.1.0" };

/** Built once per process; serveStdio may create several server instances. */
export function prepare(config: Config, sdl: string) {
  const index = buildSchemaIndex(sdl, { includeMutations: config.allowMutations });
  const client = createLinearClient({
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    allowMutations: config.allowMutations,
  });
  const formatResult = config.truncate ? truncateResponse : stringifyResponse;
  const toolOptions = { allowMutations: config.allowMutations, timeoutMs: config.timeoutMs, formatResult };

  return function createServer(): McpServer {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    registerSchemaTool(server, index, toolOptions);
    registerExecuteTool(server, client, toolOptions);
    return server;
  };
}
