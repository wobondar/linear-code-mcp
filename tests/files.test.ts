import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFiles, type FilesOptions } from "../src/files.ts";

// Layout, all under one temp root so cleanup is one rm:
//   cwd/          the pretend working directory
//   scratch/      the pretend scratchpad
//   outside/      neither
let root: string;
let cwd: string;
let scratch: string;
let outside: string;

const all: FilesOptions = { read: true, write: true, readOutsideCwd: true, writeOutsideCwd: true };
const inside: FilesOptions = { read: true, write: true, readOutsideCwd: false, writeOutsideCwd: false };
const off: FilesOptions = { read: false, write: false, readOutsideCwd: false, writeOutsideCwd: false };

const make = (options: FilesOptions, extra: Partial<FilesOptions> = {}) =>
  createFiles({ ...options, cwd, scratchRoot: scratch, ...extra });

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "files-test-")));
  cwd = join(root, "cwd");
  scratch = join(root, "scratch");
  outside = join(root, "outside");
  for (const dir of [cwd, scratch, outside, join(cwd, "docs")]) mkdirSync(dir);
  await Bun.write(join(cwd, "docs", "note.md"), "hello from cwd");
  await Bun.write(join(scratch, "dump.json"), "[1]");
  await Bun.write(join(outside, "secret.txt"), "outside");
  await Bun.write(join(cwd, ".env.local"), "KEY=1");
  await Bun.write(join(cwd, "big.txt"), "x".repeat(64));
  symlinkSync(join(outside, "secret.txt"), join(cwd, "link-out.txt"));
  symlinkSync(join(root, "missing"), join(cwd, "dangling"));
  symlinkSync(outside, join(cwd, "dir-out"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("files.read", () => {
  it("reads a file under cwd", async () => {
    expect(await make(inside).read(join(cwd, "docs", "note.md"))).toBe("hello from cwd");
  });

  it("reads a file under the scratchpad without the outside flag", async () => {
    expect(await make(inside).read(join(scratch, "dump.json"))).toBe("[1]");
  });

  it("refuses when LINEAR_MCP_FS_READ is off", async () => {
    await expect(make(off).read(join(cwd, "docs", "note.md"))).rejects.toThrow(/LINEAR_MCP_FS_READ=true/);
  });

  it("refuses a relative path", async () => {
    await expect(make(all).read("docs/note.md")).rejects.toThrow(/must be absolute/);
  });

  it("refuses a non-string path", async () => {
    await expect(make(all).read(42)).rejects.toThrow(/non-empty string/);
  });

  it("refuses outside cwd without the flag, naming the flag", async () => {
    await expect(make(inside).read(join(outside, "secret.txt"))).rejects.toThrow(/LINEAR_MCP_FS_ALLOW_READ_OUTSIDE_CWD=true/);
  });

  it("reads outside cwd with the flag", async () => {
    expect(await make(all).read(join(outside, "secret.txt"))).toBe("outside");
  });

  it("follows a symlink before checking the root", async () => {
    await expect(make(inside).read(join(cwd, "link-out.txt"))).rejects.toThrow(/outside the working directory/);
    expect(await make(all).read(join(cwd, "link-out.txt"))).toBe("outside");
  });

  it("refuses .env* files even with every flag on", async () => {
    await expect(make(all).read(join(cwd, ".env.local"))).rejects.toThrow(/\.env\* files are refused/);
  });

  it("refuses a symlink whose target is an env file", async () => {
    symlinkSync(join(cwd, ".env.local"), join(cwd, "innocent.txt"));
    await expect(make(all).read(join(cwd, "innocent.txt"))).rejects.toThrow(/\.env\* files are refused/);
  });

  it("refuses a missing file", async () => {
    await expect(make(all).read(join(cwd, "nope.md"))).rejects.toThrow(/does not exist/);
  });

  it("refuses a directory", async () => {
    await expect(make(all).read(join(cwd, "docs"))).rejects.toThrow(/not a file/);
  });

  it("refuses a file over the size limit", async () => {
    await expect(make(all, { maxReadBytes: 32 }).read(join(cwd, "big.txt"))).rejects.toThrow(/over the 32 byte limit/);
  });
});

describe("files.write", () => {
  it("creates a file under cwd and resolves to the bytes written", async () => {
    const path = join(cwd, "docs", "out.md");
    expect(await make(inside).write(path, "written ü")).toBe(10);
    expect(await Bun.file(path).text()).toBe("written ü");
  });

  it("creates a file under the scratchpad without the outside flag", async () => {
    const path = join(scratch, "out.json");
    await make(inside).write(path, "{}");
    expect(await Bun.file(path).text()).toBe("{}");
  });

  it("refuses when LINEAR_MCP_FS_WRITE is off", async () => {
    await expect(make(off).write(join(cwd, "x.md"), "x")).rejects.toThrow(/LINEAR_MCP_FS_WRITE=true/);
  });

  it("refuses a non-string body", async () => {
    await expect(make(all).write(join(cwd, "obj.json"), { a: 1 })).rejects.toThrow(/must be a string/);
  });

  it("never overwrites an existing file", async () => {
    const path = join(cwd, "docs", "note.md");
    await expect(make(all).write(path, "clobber")).rejects.toThrow(/never overwrites/);
    expect(await Bun.file(path).text()).toBe("hello from cwd");
  });

  it("never overwrites through a symlink", async () => {
    await expect(make(all).write(join(cwd, "link-out.txt"), "clobber")).rejects.toThrow(/never overwrites/);
    expect(await Bun.file(join(outside, "secret.txt")).text()).toBe("outside");
  });

  it("refuses a dangling symlink as the target", async () => {
    await expect(make(all).write(join(cwd, "dangling"), "x")).rejects.toThrow(/never overwrites/);
  });

  it("never creates directories", async () => {
    await expect(make(all).write(join(cwd, "new-dir", "x.md"), "x")).rejects.toThrow(/never creates directories/);
  });

  it("resolves the parent directory before checking the root", async () => {
    await expect(make(inside).write(join(cwd, "dir-out", "x.md"), "x")).rejects.toThrow(/LINEAR_MCP_FS_ALLOW_WRITE_OUTSIDE_CWD=true/);
  });

  it("refuses outside cwd without the flag, writes with it", async () => {
    const path = join(outside, "new.txt");
    await expect(make(inside).write(path, "x")).rejects.toThrow(/outside the working directory/);
    await make(all).write(path, "x");
    expect(await Bun.file(path).text()).toBe("x");
  });

  it("refuses .env* targets", async () => {
    await expect(make(all).write(join(cwd, ".env.production"), "x")).rejects.toThrow(/\.env\* files are refused/);
  });
});
