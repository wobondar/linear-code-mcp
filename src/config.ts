export interface Config {
  apiKey: string;
  apiUrl: string;
  /** Off unless LINEAR_MCP_ALLOW_MUTATIONS=true. */
  allowMutations: boolean;
  /** On unless LINEAR_MCP_TRUNCATE=false. */
  truncate: boolean;
  /** Wall-clock budget per sandboxed call; LINEAR_MCP_TIMEOUT_MS. */
  timeoutMs: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const apiKey = env.LINEAR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "LINEAR_API_KEY is not set. Export it, or start with `bun --env-file=/path/to/.env.local`.",
    );
  }
  const timeoutMs = Number(env.LINEAR_MCP_TIMEOUT_MS ?? 30_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`LINEAR_MCP_TIMEOUT_MS must be a positive number, got ${env.LINEAR_MCP_TIMEOUT_MS}`);
  }
  return {
    apiKey,
    apiUrl: env.LINEAR_API_URL ?? "https://api.linear.app/graphql",
    allowMutations: env.LINEAR_MCP_ALLOW_MUTATIONS === "true",
    truncate: env.LINEAR_MCP_TRUNCATE !== "false",
    timeoutMs,
  };
}
