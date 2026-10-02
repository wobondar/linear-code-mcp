import { WORKER_SOURCE } from "./sandbox-worker.ts";

/** Keyed by the name the sandbox calls: "linear.request", "files.read", "files.write". */
export type SandboxHandlers = Record<string, (...args: never[]) => Promise<unknown>>;

export interface SandboxRun {
  kind: "schema" | "execute";
  code: string;
  /** Pre-serialised schema index, handed to the worker as a string (Bun's postMessage fast path). */
  schemaJson?: string;
  /** Host-side handlers the sandbox can call; absent for the schema tool. */
  handlers?: SandboxHandlers;
  timeoutMs: number;
}

type WorkerMessage =
  | { type: "result"; json: string | undefined }
  | { type: "error"; message: string }
  | { type: "call"; id: number; api: string; args: unknown[] };

let workerUrl: string | undefined;

function getWorkerUrl(): string {
  workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "application/javascript" }));
  return workerUrl;
}

/**
 * The wall-clock timer lives on this side because nothing inside the worker
 * can interrupt a loop that never yields; terminate() from here can.
 */
export function runInSandbox(run: SandboxRun): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(getWorkerUrl(), { smol: true, env: {} });
    let settled = false;

    const settle = <T>(fn: (value: T) => void) => (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn(value);
    };
    const succeed = settle(resolve);
    const fail = settle(reject);
    const timer = setTimeout(
      () => fail(new Error(`Execution timed out after ${run.timeoutMs} ms`)),
      run.timeoutMs,
    );

    worker.onmessage = async (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "result":
          succeed(msg.json === undefined ? undefined : JSON.parse(msg.json));
          return;
        case "error":
          fail(new Error(msg.message));
          return;
        case "call": {
          const handler = run.handlers?.[msg.api];
          if (!handler) {
            worker.postMessage({ type: "response", id: msg.id, error: `${msg.api}() is not available in this tool` });
            return;
          }
          try {
            const data = await handler(...(msg.args as never[]));
            if (!settled) worker.postMessage({ type: "response", id: msg.id, data });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!settled) worker.postMessage({ type: "response", id: msg.id, error: message });
          }
          return;
        }
      }
    };
    worker.onerror = (event: ErrorEvent) => fail(new Error(event.message || "Worker crashed"));

    worker.postMessage({ type: "run", kind: run.kind, code: run.code, schemaJson: run.schemaJson });
  });
}
