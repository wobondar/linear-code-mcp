import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// Spawns the real entry point. Nothing here reaches Linear: the key is fake
// and the execute call is refused by the guard before any fetch.
describe("stdio end to end", () => {
  let client: Client;

  beforeAll(async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "LINEAR_MCP_ALLOW_MUTATIONS") env[k] = v;
    env.LINEAR_API_KEY = "lin_api_fake";
    const transport = new StdioClientTransport({
      command: "bun",
      args: ["--no-env-file", new URL("../src/index.ts", import.meta.url).pathname],
      env,
      stderr: "pipe",
    });
    client = new Client({ name: "stdio-test", version: "0.0.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client?.close();
  });

  it("lists exactly schema and execute", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["schema", "execute"]);
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(tools[1].annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    for (const tool of tools) expect(tool.description!.length / 4).toBeLessThan(1_000);
  });

  it("runs a schema search in the sandbox", async () => {
    const result = await client.callTool({
      name: "schema",
      arguments: { code: "async () => schema.queries.issue?.type ?? Object.keys(schema.queries).length" },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text === "Issue!" || /^\d+$/.test(text)).toBe(true);
  });

  it("refuses a mutation without touching the network", async () => {
    const result = await client.callTool({
      name: "execute",
      arguments: { code: 'async () => linear.request({ query: "mutation { issueDelete(id: \\"x\\") { success } }" })' },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(/refused mutation/);
  });

  it("reports a sandbox error as an MCP error result", async () => {
    const result = await client.callTool({ name: "schema", arguments: { code: "not a function" } });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(/^Error: /);
  });

  it("returns the text undefined for a bare return", async () => {
    const result = await client.callTool({ name: "schema", arguments: { code: "async () => {}" } });
    expect((result.content as Array<{ text: string }>)[0].text).toBe("undefined");
  });
});
