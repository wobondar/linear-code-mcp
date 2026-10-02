export interface FsConfig {
  /** files.read() in the sandbox; LINEAR_MCP_FS_READ=true. */
  read: boolean;
  /** files.write() in the sandbox; LINEAR_MCP_FS_WRITE=true. */
  write: boolean;
  /** Reads beyond cwd and the scratchpad; needs `read` as well. */
  readOutsideCwd: boolean;
  /** Writes beyond cwd and the scratchpad; needs `write` as well. */
  writeOutsideCwd: boolean;
  /** OUTSIDE flags set without their base flag, so the startup log can say they did nothing. */
  ignoredFlags: string[];
}

export interface Config {
  apiKey: string;
  apiUrl: string;
  /** Off unless LINEAR_MCP_ALLOW_MUTATIONS=true. */
  allowMutations: boolean;
  /** On unless LINEAR_MCP_TRUNCATE=false. */
  truncate: boolean;
  /** Wall-clock budget per sandboxed call; LINEAR_MCP_TIMEOUT_MS. */
  timeoutMs: number;
  fs: FsConfig;
}

function loadFsConfig(env: Record<string, string | undefined>): FsConfig {
  const read = env.LINEAR_MCP_FS_READ === "true";
  const write = env.LINEAR_MCP_FS_WRITE === "true";
  const readOutside = env.LINEAR_MCP_FS_ALLOW_READ_OUTSIDE_CWD === "true";
  const writeOutside = env.LINEAR_MCP_FS_ALLOW_WRITE_OUTSIDE_CWD === "true";
  const ignoredFlags = [
    readOutside && !read ? "LINEAR_MCP_FS_ALLOW_READ_OUTSIDE_CWD" : "",
    writeOutside && !write ? "LINEAR_MCP_FS_ALLOW_WRITE_OUTSIDE_CWD" : "",
  ].filter(Boolean);
  return {
    read,
    write,
    readOutsideCwd: read && readOutside,
    writeOutsideCwd: write && writeOutside,
    ignoredFlags,
  };
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
    fs: loadFsConfig(env),
  };
}
