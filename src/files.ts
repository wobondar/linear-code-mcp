// Bun has no realpath, lstat or exclusive-create of its own (Bun.write always
// overwrites); its file-io docs point at its native node:fs for exactly these.
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, sep } from "node:path";

export interface FilesOptions {
  read: boolean;
  write: boolean;
  readOutsideCwd: boolean;
  writeOutsideCwd: boolean;
  /** Defaults to process.cwd(). */
  cwd?: string;
  /** Defaults to Claude Code's per-user scratchpad root. */
  scratchRoot?: string;
  maxReadBytes?: number;
}

export interface Files {
  read(path: unknown): Promise<string>;
  /** Resolves to the bytes written. */
  write(path: unknown, text: unknown): Promise<number>;
}

export class FilesError extends Error {}

export const DEFAULT_MAX_READ_BYTES = 16 * 1024 * 1024;

/** Claude Code puts session scratchpads under /private/tmp/claude-<uid>; the model knows that path, the server cannot be told the session. */
export function defaultScratchRoot(): string {
  return `/private/tmp/claude-${process.getuid?.() ?? 0}`;
}

async function realpathOrSelf(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
}

/** Env files hold secrets and nothing in Linear ever needs their contents. */
function isEnvFile(path: string): boolean {
  return basename(path).toLowerCase().startsWith(".env");
}

export function createFiles(options: FilesOptions): Files {
  const rootsReady = Promise.all([
    realpathOrSelf(options.cwd ?? process.cwd()),
    realpathOrSelf(options.scratchRoot ?? defaultScratchRoot()),
  ]);
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;

  const checkPath = (path: unknown, op: string): string => {
    if (typeof path !== "string" || path.length === 0) {
      throw new FilesError(`${op}: path must be a non-empty string`);
    }
    if (!isAbsolute(path)) {
      throw new FilesError(`${op}: path must be absolute, got ${path}`);
    }
    if (isEnvFile(path)) {
      throw new FilesError(`${op}: .env* files are refused`);
    }
    return path;
  };

  // The scratchpad root is never printed: the model is scoped to one session under it.
  const outsideError = (op: string, path: string, roots: string[], flag: string) =>
    new FilesError(
      `${op}: ${path} is outside the working directory (${roots[0]}) and the scratchpad. Start the server with ${flag}=true to allow it.`,
    );

  return {
    async read(rawPath) {
      if (!options.read) {
        throw new FilesError("files.read() is not available. Start the server with LINEAR_MCP_FS_READ=true to allow it.");
      }
      const path = checkPath(rawPath, "files.read");
      const real = await realpath(path).catch(() => {
        throw new FilesError(`files.read: ${path} does not exist`);
      });
      if (isEnvFile(real)) {
        throw new FilesError("files.read: .env* files are refused");
      }
      const roots = await rootsReady;
      if (!options.readOutsideCwd && !roots.some((root) => isWithin(real, root))) {
        throw outsideError("files.read", path, roots, "LINEAR_MCP_FS_ALLOW_READ_OUTSIDE_CWD");
      }
      const file = Bun.file(real);
      const stat = await file.stat();
      if (!stat.isFile()) {
        throw new FilesError(`files.read: ${path} is not a file`);
      }
      if (stat.size > maxReadBytes) {
        throw new FilesError(`files.read: ${path} is ${stat.size} bytes, over the ${maxReadBytes} byte limit`);
      }
      return file.text();
    },

    async write(rawPath, text) {
      if (!options.write) {
        throw new FilesError("files.write() is not available. Start the server with LINEAR_MCP_FS_WRITE=true to allow it.");
      }
      const path = checkPath(rawPath, "files.write");
      if (typeof text !== "string") {
        throw new FilesError("files.write: text must be a string; JSON.stringify objects yourself");
      }
      const parent = await realpath(dirname(path)).catch(() => {
        throw new FilesError(`files.write: the directory of ${path} does not exist. files.write() never creates directories.`);
      });
      if (!(await Bun.file(parent).stat()).isDirectory()) {
        throw new FilesError(`files.write: the parent of ${path} is not a directory`);
      }
      const target = join(parent, basename(path));
      const roots = await rootsReady;
      if (!options.writeOutsideCwd && !roots.some((root) => isWithin(target, root))) {
        throw outsideError("files.write", path, roots, "LINEAR_MCP_FS_ALLOW_WRITE_OUTSIDE_CWD");
      }
      // lstat sees a dangling symlink; the exclusive open below closes the race.
      const exists = await lstat(target).then(() => true, () => false);
      if (exists) {
        throw new FilesError(`files.write: ${path} already exists. files.write() never overwrites.`);
      }
      const handle = await open(target, "wx").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "EEXIST") {
          throw new FilesError(`files.write: ${path} already exists. files.write() never overwrites.`);
        }
        throw error;
      });
      try {
        return await Bun.write(Bun.file(handle.fd), text);
      } finally {
        await handle.close();
      }
    },
  };
}
