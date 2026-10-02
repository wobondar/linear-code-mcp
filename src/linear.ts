import { assertAllowed } from "./guard.ts";

export interface LinearRequest {
  query: string;
  variables?: Record<string, unknown>;
  /** Return `data` even when `errors` is present. Off by default: partial data throws. */
  allowPartial?: boolean;
}

export interface LinearClientOptions {
  apiKey: string;
  apiUrl: string;
  allowMutations: boolean;
  fetch?: typeof fetch;
  maxRetries?: number;
  /** A server-requested wait longer than this is not honoured; the 429 is surfaced instead. */
  maxDelayMs?: number;
}

export type LinearClient = (request: LinearRequest) => Promise<unknown>;

interface GraphQLError {
  message: string;
  path?: Array<string | number>;
  extensions?: { code?: string; userPresentableMessage?: string };
}

interface GraphQLResponse {
  data?: Record<string, unknown> | null;
  errors?: GraphQLError[];
}

const USER_AGENT = "linear-codemode-mcp/0.2";

export function createLinearClient(options: LinearClientOptions): LinearClient {
  const doFetch = options.fetch ?? fetch;
  const maxRetries = options.maxRetries ?? 3;
  const maxDelayMs = options.maxDelayMs ?? 5_000;

  return async ({ query, variables, allowPartial }) => {
    if (typeof query !== "string") throw new TypeError("request(): `query` must be a string");
    if (variables !== undefined && (typeof variables !== "object" || variables === null || Array.isArray(variables))) {
      throw new TypeError("request(): `variables` must be a plain object");
    }
    assertAllowed(query, options.allowMutations);

    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Personal API keys go bare; OAuth tokens would need `Bearer `.
        authorization: options.apiKey,
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify({ query, variables }),
    };

    const response = await fetchWithRetry(doFetch, options.apiUrl, init, maxRetries, maxDelayMs);
    const text = await response.text();

    let json: GraphQLResponse;
    try {
      json = JSON.parse(text) as GraphQLResponse;
    } catch {
      throw new Error(`Linear API error: ${response.status} ${text.slice(0, 500)}`);
    }

    const errors = json.errors ?? [];
    if (errors.length > 0 && (json.data == null || !allowPartial)) {
      const prefix = json.data == null ? "Linear GraphQL error" : "Linear GraphQL partial response (pass allowPartial: true to keep data)";
      throw new Error(`${prefix}: ${errors.map(describeError).join("; ")}`);
    }
    if (!response.ok && errors.length === 0) {
      throw new Error(`Linear API error: ${response.status} ${text.slice(0, 500)}`);
    }
    return json.data;
  };
}

function describeError(error: GraphQLError): string {
  const message = error.extensions?.userPresentableMessage ?? error.message;
  const code = error.extensions?.code ? ` [${error.extensions.code}]` : "";
  const path = error.path?.length ? ` (at ${error.path.join(".")})` : "";
  return `${message}${code}${path}`;
}

/** Retries 429 and network failures only; 4xx/5xx come back as-is. */
async function fetchWithRetry(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  maxRetries: number,
  maxDelayMs: number,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await doFetch(url, init);
      if (response.status !== 429 || attempt === maxRetries) return response;
      const serverDelay = retryAfterMs(response.headers);
      if (serverDelay !== undefined && serverDelay > maxDelayMs) return response;
      await sleep(serverDelay ?? backoff(attempt, maxDelayMs));
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      await sleep(backoff(attempt, maxDelayMs));
    }
  }
  throw lastError;
}

function retryAfterMs(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function backoff(attempt: number, maxDelayMs: number): number {
  const capped = Math.min(1000 * 2 ** attempt, maxDelayMs);
  return capped * (0.5 + Math.random() * 0.5);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
