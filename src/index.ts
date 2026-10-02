#!/usr/bin/env bun
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.ts";
import { prepare } from "./server.ts";

// stdout is the MCP wire; every human-facing line goes to stderr.
const log = (message: string) => console.error(`[linear-codemode-mcp] ${message}`);

let config;
try {
  config = loadConfig();
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const sdlFile = Bun.file(new URL("../schema/linear.graphql", import.meta.url));
if (!(await sdlFile.exists())) {
  log("schema/linear.graphql is missing. Run: bun scripts/update-schema.ts");
  process.exit(1);
}

const createServer = prepare(config, await sdlFile.text());
const fsMode = [
  config.fs.read ? `read${config.fs.readOutsideCwd ? " anywhere" : ""}` : "",
  config.fs.write ? `write${config.fs.writeOutsideCwd ? " anywhere" : ""}` : "",
].filter(Boolean).join("+") || "off";
log(`ready: ${config.allowMutations ? "mutations enabled" : "read-only"}, truncate ${config.truncate ? "on" : "off"}, timeout ${config.timeoutMs} ms, files ${fsMode}`);
for (const flag of config.fs.ignoredFlags) log(`${flag} is set without its base flag and does nothing`);

serveStdio(createServer, { onerror: (error) => log(`transport error: ${error.message}`) });
