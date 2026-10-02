import { McpServer } from "@modelcontextprotocol/server";
import type { Config } from "./config.ts";
import { createFiles } from "./files.ts";
import { createLinearClient } from "./linear.ts";
import { buildSchemaIndex } from "./schema-index.ts";
import { registerExecuteTool } from "./tools/execute.ts";
import { registerSchemaTool } from "./tools/schema.ts";
import { stringifyResponse, truncateResponse } from "./truncate.ts";

export const SERVER_INFO = { name: "linear-codemode-mcp", version: "0.2.0" };

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
  const files = config.fs.read || config.fs.write
    ? {
        api: createFiles(config.fs),
        description: { fs: config.fs, cwd: process.cwd() },
      }
    : undefined;

  return function createServer(): McpServer {
    const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
    registerSchemaTool(server, index, toolOptions);
    registerExecuteTool(server, client, { ...toolOptions, files });
    return server;
  };
}
