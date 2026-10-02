import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { runInSandbox } from "../sandbox.ts";
import type { SchemaIndex } from "../schema-index.ts";
import type { FormatToolResult } from "../truncate.ts";
import { formatError } from "../errors.ts";

const SCHEMA_TYPES = `interface Field { type: string; args?: Record<string, string>; description?: string; deprecated?: string }
interface TypeInfo { kind: "OBJECT" | "INTERFACE" | "UNION" | "ENUM" | "INPUT_OBJECT" | "SCALAR"; description?: string; fields?: Record<string, Field>; values?: string[]; possibleTypes?: string[]; interfaces?: string[] }
declare const schema: { queries: Record<string, Field>; mutations?: Record<string, Field>; types: Record<string, TypeInfo> };
// Types are SDL strings ("Issue!", "[Comment!]!"); strip [!] to look a type up in schema.types.
// Lists are connections: args first/after/filter/orderBy/includeArchived; select { nodes { ... } pageInfo { hasNextPage endCursor } }.`;

const EXAMPLES = `// Root queries matching a word
async () => Object.entries(schema.queries).filter(([n]) => /comment/i.test(n)).map(([n, f]) => ({ n, type: f.type, args: f.args }))

// Scalar fields of a type (the ones you can select without a sub-selection)
async () => Object.entries(schema.types.Comment.fields).filter(([, f]) => !schema.types[f.type.replace(/[!\\[\\]]/g, "")]?.fields).map(([n, f]) => \`\${n}: \${f.type}\`)

// Filter input for a connection
async () => schema.types.CommentFilter.fields`;

export function describeSchemaTool(index: SchemaIndex, allowMutations: boolean): string {
  const queries = Object.keys(index.queries);
  const mutations = index.mutations ? Object.keys(index.mutations) : [];
  const scope = allowMutations
    ? `Query and Mutation and the types they reach. Mutations are enabled on this server.`
    : `Query and the types it reaches; no mutations.`;
  const roots = [
    `Root queries: ${queries.slice(0, 40).join(", ")}, ... (${queries.length} total)`,
    allowMutations ? `Root mutations: ${mutations.slice(0, 20).join(", ")}, ... (${mutations.length} total)` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `Search the Linear GraphQL schema with JavaScript. Scope: ${scope} Code runs with no network and no linear object; only its return value comes back, so return the few fields you need.

${roots}

Types:
${SCHEMA_TYPES}

Your code must be an async arrow function that returns the result.

Examples:
${EXAMPLES}`;
}

export function registerSchemaTool(
  server: McpServer,
  index: SchemaIndex,
  options: { allowMutations: boolean; timeoutMs: number; formatResult: FormatToolResult },
): void {
  const schemaJson = JSON.stringify(index);
  server.registerTool(
    "schema",
    {
      title: "Linear schema search",
      description: describeSchemaTool(index, options.allowMutations),
      inputSchema: z.object({
        code: z.string().describe("JavaScript async arrow function that reads `schema` and returns the result"),
      }),
      annotations: { title: "Linear schema search", readOnlyHint: true, openWorldHint: false },
    },
    async ({ code }) => {
      try {
        const result = await runInSandbox({ kind: "schema", code, schemaJson, timeoutMs: options.timeoutMs });
        return { content: [{ type: "text", text: options.formatResult(result) }] };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
