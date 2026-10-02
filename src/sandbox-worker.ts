/**
 * A string, not a module, so it can load from a blob URL with no file on disk.
 * Nothing in it is type-checked and it must not import anything.
 *
 * Protocol with the host:
 *   host -> worker  { type: "run", kind: "schema" | "execute", code, schemaJson? }
 *   worker -> host  { type: "request", id, options }
 *   host -> worker  { type: "response", id, data } | { type: "response", id, error }
 *   worker -> host  { type: "result", json } | { type: "error", message }
 *
 * The parameter list of `new Function` shadows every global that could reach
 * the network, the process or the message channel. `bridgeRequest` is defined
 * outside that function so it keeps the real postMessage. The API key never
 * enters this thread.
 */
export const WORKER_SOURCE = String.raw`
"use strict";
const pending = new Map();
let nextId = 0;

function bridgeRequest(options) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    postMessage({ type: "request", id, options });
  });
}

const SHADOWED = ["fetch", "process", "Bun", "require", "globalThis", "self", "postMessage", "addEventListener", "onmessage", "close", "WebSocket", "XMLHttpRequest", "EventSource"];

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === "response") {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error !== undefined) p.reject(new Error(msg.error));
    else p.resolve(msg.data);
    return;
  }
  if (msg.type !== "run") return;

  try {
    const schema = msg.schemaJson === undefined ? undefined : JSON.parse(msg.schemaJson);
    const linear = msg.kind === "execute" ? { request: bridgeRequest } : undefined;
    const factory = new Function("linear", "schema", ...SHADOWED, '"use strict"; return (' + msg.code + ');');
    const callable = factory(linear, schema);
    if (typeof callable !== "function") {
      throw new TypeError("Code must be a function expression, for example: async () => { ... }");
    }
    const result = await callable();
    postMessage({ type: "result", json: JSON.stringify(result) });
  } catch (error) {
    postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
`;
