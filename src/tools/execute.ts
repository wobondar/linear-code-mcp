import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { formatError } from "../errors.ts";
import type { LinearClient } from "../linear.ts";
import { runInSandbox } from "../sandbox.ts";
import type { FormatToolResult } from "../truncate.ts";

const LINEAR_TYPES = `declare const linear: {
  // Resolves to the GraphQL \`data\` object. Throws on HTTP errors, GraphQL errors, and refused operations.
  // A response with both data and errors throws too, unless allowPartial is true.
  request<T = any>(options: { query: string; variables?: Record<string, unknown>; allowPartial?: boolean }): Promise<T>;
};`;

const EXAMPLE = `async () => {
  const { issue } = await linear.request({
    query: \`query($id: String!) { issue(id: $id) { title state { name } comments(first: 50) { nodes { createdAt body user { name } } } } }\`,
    variables: { id: "ENG-123" }
  });
  return { title: issue.title, state: issue.state.name, comments: issue.comments.nodes.map(c => ({ author: c.user?.name, createdAt: c.createdAt, body: c.body.slice(0, 120) })) };
}`;

export function describeExecuteTool(allowMutations: boolean): string {
  const mode = allowMutations
    ? "Mutations are enabled on this server; subscriptions are rejected."
    : "Read-only: mutations and subscriptions are rejected before any request is sent.";
  return `Run JavaScript against the Linear GraphQL API. ${mode} Use the 'schema' tool to find fields, then call linear.request(). Only your return value is sent back, so select and shape just what you need.

Available in your code:
${LINEAR_TYPES}

Your code must be an async arrow function that returns the result.

Issues accept identifiers: issue(id: "ENG-123"). Connections return 50 nodes by default; page with first/after and pageInfo { hasNextPage endCursor }. A query may cost at most 10,000 complexity points and each connection multiplies its children by \`first\`, so keep nested \`first\` small.

Example:
${EXAMPLE}`;
}

export function registerExecuteTool(
  server: McpServer,
  client: LinearClient,
  options: { allowMutations: boolean; timeoutMs: number; formatResult: FormatToolResult },
): void {
  server.registerTool(
    "execute",
    {
      title: "Linear API code executor",
      description: describeExecuteTool(options.allowMutations),
      inputSchema: z.object({
        code: z.string().describe("JavaScript async arrow function that calls linear.request() and returns the result"),
      }),
      annotations: {
        title: "Linear API code executor",
        readOnlyHint: !options.allowMutations,
        destructiveHint: options.allowMutations,
        openWorldHint: true,
      },
    },
    async ({ code }) => {
      try {
        const result = await runInSandbox({ kind: "execute", code, request: client, timeoutMs: options.timeoutMs });
        return { content: [{ type: "text", text: options.formatResult(result) }] };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
