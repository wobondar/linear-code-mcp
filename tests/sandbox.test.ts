import { describe, expect, it } from "bun:test";
import { runInSandbox, type SandboxRun } from "../src/sandbox.ts";

const run = (code: string, extra: Partial<SandboxRun> = {}) =>
  runInSandbox({ kind: "execute", code, timeoutMs: 2_000, ...extra });

describe("runInSandbox", () => {
  it("returns the awaited value, JSON-normalised", async () => {
    expect(await run("async () => ({ n: 1, d: new Date(0), u: undefined })")).toEqual({ n: 1, d: "1970-01-01T00:00:00.000Z" });
  });

  it("returns undefined for a function that returns nothing", async () => {
    expect(await run("async () => {}")).toBeUndefined();
  });

  it("accepts a sync function expression too", async () => {
    expect(await run("() => 'sync'")).toBe("sync");
  });

  it("rejects code that is not a function", async () => {
    await expect(run("42")).rejects.toThrow(/must be a function expression/);
  });

  it("surfaces a syntax error", async () => {
    await expect(run("async () => {")).rejects.toThrow();
  });

  it("surfaces a thrown error by message", async () => {
    await expect(run('async () => { throw new Error("boom") }')).rejects.toThrow("boom");
  });

  it("bridges linear.request to the host handler", async () => {
    const seen: unknown[] = [];
    const result = await run('async () => linear.request({ query: "{ viewer { id } }", variables: { a: 1 } })', {
      request: async (options) => {
        seen.push(options);
        return { viewer: { id: "u1" } };
      },
    });
    expect(result).toEqual({ viewer: { id: "u1" } });
    expect(seen).toEqual([{ query: "{ viewer { id } }", variables: { a: 1 } }]);
  });

  it("turns a host-side request error into a catchable error in the sandbox", async () => {
    const result = await run(
      'async () => { try { await linear.request({ query: "x" }); return "no"; } catch (e) { return e.message; } }',
      { request: async () => { throw new Error("refused by guard"); } },
    );
    expect(result).toBe("refused by guard");
  });

  it("has no linear object in the schema tool", async () => {
    expect(await run("async () => typeof linear", { kind: "schema" })).toBe("undefined");
  });

  it("hands the schema tool a parsed schema", async () => {
    expect(await run("async () => Object.keys(schema.queries)", { kind: "schema", schemaJson: JSON.stringify({ queries: { issue: {} }, types: {} }) })).toEqual(["issue"]);
  });

  it("shadows fetch, process and Bun", async () => {
    expect(await run("async () => [typeof fetch, typeof process, typeof Bun, typeof require, typeof postMessage]")).toEqual([
      "undefined", "undefined", "undefined", "undefined", "undefined",
    ]);
  });

  it("does not expose the host environment", async () => {
    process.env.SANDBOX_TEST_SECRET = "leak";
    try {
      const result = await run('async () => { const p = await import("node:process"); return p.env.SANDBOX_TEST_SECRET ?? "unset" }');
      expect(result).toBe("unset");
    } finally {
      delete process.env.SANDBOX_TEST_SECRET;
    }
  });

  it("kills a loop that spins after an await", async () => {
    const started = performance.now();
    await expect(run("async () => { await 0; while (true) {} }", { timeoutMs: 300 })).rejects.toThrow(/timed out after 300 ms/);
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  it("keeps working after a timeout", async () => {
    await run("async () => { while (true) {} }", { timeoutMs: 100 }).catch(() => {});
    expect(await run("async () => 2 + 2")).toBe(4);
  });

  it("rejects a result that cannot be serialised", async () => {
    await expect(run("async () => 10n")).rejects.toThrow(/BigInt/);
  });
});
