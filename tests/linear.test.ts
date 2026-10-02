import { describe, expect, it } from "bun:test";
import { createLinearClient } from "../src/linear.ts";

interface Call { url: string; init: RequestInit }

function fakeFetch(responses: Array<() => Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) throw new Error("fakeFetch: no response queued");
    return next();
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const client = (fetchImpl: typeof fetch, allowMutations = false) =>
  createLinearClient({ apiKey: "lin_api_test", apiUrl: "https://example.test/graphql", allowMutations, fetch: fetchImpl, maxRetries: 2, maxDelayMs: 50 });

describe("createLinearClient", () => {
  it("posts the document with a bare Authorization header and resolves to data", async () => {
    const { fetch, calls } = fakeFetch([json({ data: { viewer: { id: "u1" } } })]);
    const data = await client(fetch)({ query: "{ viewer { id } }", variables: { a: 1 } });
    expect(data).toEqual({ viewer: { id: "u1" } });
    expect(calls[0].url).toBe("https://example.test/graphql");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("lin_api_test");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ query: "{ viewer { id } }", variables: { a: 1 } });
  });

  it("refuses a mutation before fetching", async () => {
    const { fetch, calls } = fakeFetch([]);
    await expect(client(fetch)({ query: "mutation { x { id } }" })).rejects.toThrow(/refused mutation/);
    expect(calls).toHaveLength(0);
  });

  it("sends a mutation when allowed", async () => {
    const { fetch, calls } = fakeFetch([json({ data: { x: { id: 1 } } })]);
    await client(fetch, true)({ query: "mutation { x { id } }" });
    expect(calls).toHaveLength(1);
  });

  it("throws on GraphQL errors with the presentable message, code and path", async () => {
    const { fetch } = fakeFetch([
      json({
        errors: [{ message: "raw", path: ["issue", "x"], extensions: { code: "GRAPHQL_VALIDATION_FAILED", userPresentableMessage: "Nice message" } }],
      }, 400),
    ]);
    await expect(client(fetch)({ query: "{ issue { x } }" })).rejects.toThrow(
      "Linear GraphQL error: Nice message [GRAPHQL_VALIDATION_FAILED] (at issue.x)",
    );
  });

  it("throws on a partial response unless allowPartial", async () => {
    const body = { data: { a: 1 }, errors: [{ message: "b failed", path: ["b"] }] };
    const first = fakeFetch([json(body)]);
    await expect(client(first.fetch)({ query: "{ a b }" })).rejects.toThrow(/partial response.*allowPartial.*b failed \(at b\)/);
    const second = fakeFetch([json(body)]);
    expect(await client(second.fetch)({ query: "{ a b }", allowPartial: true })).toEqual({ a: 1 });
  });

  it("throws on a non-JSON body with the status", async () => {
    const { fetch } = fakeFetch([() => new Response("<html>nope</html>", { status: 502 })]);
    await expect(client(fetch)({ query: "{ a }" })).rejects.toThrow("Linear API error: 502 <html>nope</html>");
  });

  it("retries a 429 once the server-given wait fits", async () => {
    const { fetch, calls } = fakeFetch([json({ errors: [{ message: "slow down" }] }, 429, { "retry-after": "0" }), json({ data: { a: 1 } })]);
    expect(await client(fetch)({ query: "{ a }" })).toEqual({ a: 1 });
    expect(calls).toHaveLength(2);
  });

  it("gives up at once when the server asks for a long wait", async () => {
    const { fetch, calls } = fakeFetch([json({ errors: [{ message: "ratelimited", extensions: { code: "RATELIMITED" } }] }, 429, { "retry-after": "3600" })]);
    await expect(client(fetch)({ query: "{ a }" })).rejects.toThrow(/ratelimited \[RATELIMITED\]/);
    expect(calls).toHaveLength(1);
  });

  it("retries a network failure and then succeeds", async () => {
    const { fetch, calls } = fakeFetch([() => { throw new Error("ECONNRESET"); }, json({ data: { a: 1 } })]);
    expect(await client(fetch)({ query: "{ a }" })).toEqual({ a: 1 });
    expect(calls).toHaveLength(2);
  });

  it("rejects a non-string query and non-object variables", async () => {
    const { fetch } = fakeFetch([]);
    await expect(client(fetch)({ query: 1 as unknown as string })).rejects.toThrow(/must be a string/);
    await expect(client(fetch)({ query: "{ a }", variables: [] as unknown as Record<string, unknown> })).rejects.toThrow(/plain object/);
  });
});
