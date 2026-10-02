import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { FsConfig } from "../config.ts";
import { formatError } from "../errors.ts";
import type { Files } from "../files.ts";
import type { LinearClient } from "../linear.ts";
import { runInSandbox, type SandboxHandlers } from "../sandbox.ts";
import type { FormatToolResult } from "../truncate.ts";

const LINEAR_TYPES = `declare const linear: {
  // Resolves to the GraphQL \`data\` object. Throws on HTTP errors, GraphQL errors, and refused operations.
  // A response with both data and errors throws too, unless allowPartial is true.
  request<T = any>(options: { query: string; variables?: Record<string, unknown>; allowPartial?: boolean }): Promise<T>;
};`;

export interface FilesDescription {
  fs: FsConfig;
  cwd: string;
}

/** Names the working directory but not the scratchpad root: the model is scoped to one session under it. */
function describeFiles({ fs, cwd }: FilesDescription): string {
  if (!fs.read && !fs.write) return "";
  const where = (outside: boolean) =>
    outside ? "any absolute path" : `absolute paths under ${cwd} or your scratchpad`;
  const members = [
    fs.read ? `  // UTF-8 text; ${where(fs.readOutsideCwd)}. .env* files are refused.\n  read(path: string): Promise<string>;` : "",
    fs.write
      ? `  // UTF-8 text; ${where(fs.writeOutsideCwd)}. Never overwrites, never creates directories. .env* files are refused. Resolves to the bytes written.\n  write(path: string, text: string): Promise<number>;`
      : "",
  ].filter(Boolean);
  return `\ndeclare const files: {\n${members.join("\n")}\n};`;
}

const EXAMPLE = `async () => {
  const { issue } = await linear.request({
    query: \`query($id: String!) { issue(id: $id) { title state { name } comments(first: 50) { nodes { createdAt body user { name } } } } }\`,
    variables: { id: "ENG-123" }
  });
  return { title: issue.title, state: issue.state.name, comments: issue.comments.nodes.map(c => ({ author: c.user?.name, createdAt: c.createdAt, body: c.body.slice(0, 120) })) };
}`;

export function describeExecuteTool(allowMutations: boolean, files?: FilesDescription): string {
  const mode = allowMutations
    ? "Mutations are enabled on this server; subscriptions are rejected."
    : "Read-only: mutations and subscriptions are rejected before any request is sent.";
  const filesHint = files && (files.fs.read || files.fs.write)
    ? " files.read() and files.write() move text between local files and Linear without it passing through you."
    : "";
  return `Run JavaScript against the Linear GraphQL API. ${mode} Use the 'schema' tool to find fields, then call linear.request(). Only your return value is sent back, so select and shape just what you need.${filesHint}

Available in your code:
${LINEAR_TYPES}${files ? describeFiles(files) : ""}

Your code must be an async arrow function that returns the result.

Issues accept identifiers: issue(id: "ENG-123"). Connections return 50 nodes by default; page with first/after and pageInfo { hasNextPage endCursor }. A query may cost at most 10,000 complexity points and each connection multiplies its children by \`first\`, so keep nested \`first\` small.

Example:
${EXAMPLE}`;
}

export function registerExecuteTool(
  server: McpServer,
  client: LinearClient,
  options: {
    allowMutations: boolean;
    timeoutMs: number;
    formatResult: FormatToolResult;
    files?: { api: Files; description: FilesDescription };
  },
): void {
  const handlers: SandboxHandlers = { "linear.request": client };
  if (options.files) {
    handlers["files.read"] = options.files.api.read;
    handlers["files.write"] = options.files.api.write;
  }
  const writes = options.allowMutations || options.files?.description.fs.write === true;
  server.registerTool(
    "execute",
    {
      title: "Linear API code executor",
      description: describeExecuteTool(options.allowMutations, options.files?.description),
      inputSchema: z.object({
        code: z.string().describe("JavaScript async arrow function that calls linear.request() and returns the result"),
      }),
      annotations: {
        title: "Linear API code executor",
        readOnlyHint: !writes,
        destructiveHint: writes,
        openWorldHint: true,
      },
    },
    async ({ code }) => {
      try {
        const result = await runInSandbox({ kind: "execute", code, handlers, timeoutMs: options.timeoutMs });
        return { content: [{ type: "text", text: options.formatResult(result) }] };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
