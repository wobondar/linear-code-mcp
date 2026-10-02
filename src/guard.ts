import { Kind, parse, type OperationTypeNode } from "graphql";

export class GuardError extends Error {
  override name = "GuardError";
}

/**
 * Runs on the host side of the sandbox bridge, right before fetch, so no
 * sandboxed code path can skip it. Every operation is checked, not just the
 * one named by operationName, so a mixed document is refused outright.
 */
export function assertAllowed(query: string, allowMutations: boolean): void {
  let document;
  try {
    document = parse(query);
  } catch (error) {
    throw new GuardError(`Invalid GraphQL: ${error instanceof Error ? error.message : String(error)}`);
  }

  const operations: OperationTypeNode[] = [];
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) operations.push(definition.operation);
  }
  if (operations.length === 0) throw new GuardError("Document has no operation to execute.");

  for (const operation of operations) {
    if (operation === "query") continue;
    if (operation === "mutation" && allowMutations) continue;
    const hint =
      operation === "mutation"
        ? " Start the server with LINEAR_MCP_ALLOW_MUTATIONS=true to allow mutations."
        : "";
    throw new GuardError(
      `Read-only server: refused ${operation} operation. Only query operations are allowed.${hint}`,
    );
  }
}
