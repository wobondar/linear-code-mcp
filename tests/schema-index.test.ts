import { describe, expect, it } from "bun:test";
import { buildSchemaIndex } from "../src/schema-index.ts";

const SDL = `
"""A thing"""
interface Node { id: ID! }
type Query {
  """One issue"""
  issue(id: String!): Issue!
  issues(first: Int, filter: IssueFilter): IssueConnection!
  search: SearchResult
}
type Mutation { issueDelete(id: String!): DeletePayload! }
type Subscription { ping: Boolean }
type Issue implements Node { id: ID!, title: String!, state: State!, old: String @deprecated(reason: "use title") }
type IssueConnection { nodes: [Issue!]! }
input IssueFilter { title: StringComparator }
input StringComparator { eq: String }
enum State { OPEN CLOSED }
union SearchResult = Issue | Doc
type Doc { id: ID! }
type DeletePayload { success: Boolean!, orphan: Orphan }
type Orphan { id: ID! }
`;

describe("buildSchemaIndex", () => {
  const index = buildSchemaIndex(SDL);

  it("lists root queries with SDL type strings, args and descriptions", () => {
    expect(index.queries.issue).toEqual({ type: "Issue!", args: { id: "String!" }, description: "One issue" });
    expect(index.queries.search).toEqual({ type: "SearchResult" });
  });

  it("keeps only Query-reachable types and drops the roots themselves", () => {
    expect(Object.keys(index.types).sort()).toEqual([
      "Doc", "ID", "Int", "Issue", "IssueConnection", "IssueFilter", "Node", "SearchResult", "State", "String", "StringComparator",
    ]);
    expect(index.mutations).toBeUndefined();
  });

  it("describes each kind", () => {
    expect(index.types.Issue.kind).toBe("OBJECT");
    expect(index.types.Issue.interfaces).toEqual(["Node"]);
    expect(index.types.Issue.fields!.old).toEqual({ type: "String", deprecated: "use title" });
    expect(index.types.Node).toEqual({ kind: "INTERFACE", description: "A thing", fields: { id: { type: "ID!" } }, possibleTypes: ["Issue"] });
    expect(index.types.SearchResult).toEqual({ kind: "UNION", possibleTypes: ["Issue", "Doc"] });
    expect(index.types.State).toEqual({ kind: "ENUM", values: ["OPEN", "CLOSED"] });
    expect(index.types.IssueFilter).toEqual({ kind: "INPUT_OBJECT", fields: { title: { type: "StringComparator" } } });
    expect(index.types.ID).toEqual({ kind: "SCALAR", description: expect.any(String) });
  });

  it("adds mutations and their payload types when asked", () => {
    const withMutations = buildSchemaIndex(SDL, { includeMutations: true });
    expect(withMutations.mutations).toEqual({ issueDelete: { type: "DeletePayload!", args: { id: "String!" } } });
    expect(withMutations.types.DeletePayload.kind).toBe("OBJECT");
    expect(withMutations.types.Orphan.kind).toBe("OBJECT");
    expect(withMutations.types.Mutation).toBeUndefined();
  });

  it("never includes Subscription or introspection types", () => {
    const withMutations = buildSchemaIndex(SDL, { includeMutations: true });
    for (const name of Object.keys(withMutations.types)) {
      expect(name.startsWith("__")).toBe(false);
      expect(name).not.toBe("Subscription");
    }
  });
});

describe("buildSchemaIndex on the vendored Linear SDL", () => {
  it("builds and exposes the issue query", async () => {
    const file = Bun.file(new URL("../schema/linear.graphql", import.meta.url));
    if (!(await file.exists())) return;
    const index = buildSchemaIndex(await file.text());
    expect(index.queries.issue.type).toBe("Issue!");
    expect(index.types.Comment.kind).toBe("OBJECT");
    expect(index.types.CommentFilter.kind).toBe("INPUT_OBJECT");
    expect(Object.keys(index.queries).length).toBeGreaterThan(100);
    expect(index.types.IssueUpdateInput).toBeUndefined();
  });
});
