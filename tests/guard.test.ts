import { describe, expect, it } from "bun:test";
import { assertAllowed, GuardError } from "../src/guard.ts";

describe("assertAllowed, read-only", () => {
  it("allows a named query", () => {
    expect(() => assertAllowed("query Q { viewer { id } }", false)).not.toThrow();
  });

  it("allows the anonymous shorthand", () => {
    expect(() => assertAllowed("{ viewer { id } }", false)).not.toThrow();
  });

  it("allows a query with fragments", () => {
    expect(() => assertAllowed("fragment F on User { id } query { viewer { ...F } }", false)).not.toThrow();
  });

  it("refuses a mutation and names the flag", () => {
    expect(() => assertAllowed('mutation { issueUpdate(id: "x", input: { title: "y" }) { success } }', false)).toThrow(
      /refused mutation operation.*LINEAR_MCP_ALLOW_MUTATIONS=true/,
    );
  });

  it("refuses a subscription", () => {
    expect(() => assertAllowed("subscription { issueUpdated { id } }", false)).toThrow(/refused subscription/);
  });

  it("refuses a mixed document even when the query comes first", () => {
    expect(() => assertAllowed("query A { viewer { id } } mutation B { issueDelete(id: \"x\") { success } }", false)).toThrow(
      /refused mutation/,
    );
  });

  it("refuses a document with only fragments", () => {
    expect(() => assertAllowed("fragment F on User { id }", false)).toThrow(/no operation/);
  });

  it("reports a parse error as a GuardError", () => {
    expect(() => assertAllowed("{ viewer { id ", false)).toThrow(GuardError);
    expect(() => assertAllowed("{ viewer { id ", false)).toThrow(/Invalid GraphQL: Syntax Error/);
  });
});

describe("assertAllowed, mutations enabled", () => {
  it("allows a mutation", () => {
    expect(() => assertAllowed('mutation { issueUpdate(id: "x", input: { title: "y" }) { success } }', true)).not.toThrow();
  });

  it("still refuses a subscription without the flag hint", () => {
    expect(() => assertAllowed("subscription { issueUpdated { id } }", true)).toThrow(/refused subscription operation\. Only query operations are allowed\.$/);
  });
});
