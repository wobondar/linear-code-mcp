# linear-codemode-mcp

A local MCP server for Linear in the [code mode](https://blog.cloudflare.com/code-mode-mcp/) pattern. The agent writes JavaScript, the server runs it in a throwaway worker, and only the return value comes back. Two tools instead of ninety in `linear-mcp`, under 1K tokens of tool descriptions instead of tens of thousands.

Read-only by default. Mutations are refused on the host before any request leaves the process, whatever the API key can do.

## Tools

| Tool | What the agent's code gets | Network |
|---|---|---|
| `schema` | `schema.queries`, `schema.types` (and `schema.mutations` when enabled): the Linear SDL projected to plain objects, type references as SDL strings | none |
| `execute` | `linear.request({ query, variables, allowPartial })`, which resolves to GraphQL `data` and throws on any error | Linear only, via the host |

Results over about 6,000 tokens are cut structurally so they stay valid JSON (Cloudflare's `truncate.ts`, Apache-2.0, see `LICENSE-cloudflare-mcp`).

## Run

Requires [Bun](https://bun.sh).

```sh
bun install            # also fetches schema/linear.graphql
cp .env.example .env.local   # then put your key in it
bun test
bun start              # speaks MCP on stdio
```

The MCP host spawns the server from its own working directory, so Bun needs an absolute path to the env file. For Claude Code, user scope:

```sh
claude mcp add --scope user linear-code -- bun --env-file=/ABS/PATH/linear-codemode-mcp/.env.local /ABS/PATH/linear-codemode-mcp/src/index.ts
```

For a project-level `.mcp.json`, or any other host that takes a JSON server block, copy `.mcp.json.example` and fix the paths.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `LINEAR_API_KEY` | required | Personal API key, sent as a bare `Authorization` header |
| `LINEAR_MCP_ALLOW_MUTATIONS` | unset | `true` lets `mutation` operations through and adds `schema.mutations`. Subscriptions are always refused |
| `LINEAR_MCP_TRUNCATE` | `true` | `false` returns whole results |
| `LINEAR_MCP_TIMEOUT_MS` | `30000` | Wall-clock budget per call; the worker is terminated when it expires |
| `LINEAR_API_URL` | `https://api.linear.app/graphql` | |

## How a call runs

1. The tool handler spawns a fresh Bun `Worker` from a blob URL with `env: {}` and `smol: true`.
2. The agent's code is compiled with `new Function` whose parameters shadow `fetch`, `process`, `Bun`, `require`, `postMessage` and the other globals that reach outside the worker, then awaited.
3. `linear.request()` posts to the host thread. The host parses the document with `graphql`, refuses anything that is not a `query` (or `mutation` when enabled), then fetches with the key. The key never enters the worker.
4. The return value is JSON-serialised in the worker, truncated on the host, and sent back as text.
5. The worker is terminated. A loop that never yields dies with the timer.

This is a guardrail, not a security boundary against a hostile author. The author owns the key.

## Updating the schema

`bun run update-schema` pulls `packages/sdk/src/schema.graphql` from [linear/linear](https://github.com/linear/linear). The file is gitignored; the server refuses to start without it.

## Credits

- [@cloudflare](https://github.com/cloudflare) for [cloudflare/mcp](https://github.com/cloudflare/mcp) inspiration.

## License

MIT