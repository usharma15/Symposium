export type SymposiumApiRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  cache?: RequestCache;
  idempotencyKey?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

export class SymposiumApiError extends Error {
  readonly status: number | null;
  readonly payload: unknown;

  constructor(message: string, options?: { status?: number | null; payload?: unknown; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SymposiumApiError";
    this.status = options?.status ?? null;
    this.payload = options?.payload;
  }
}

const parseResponseBody = async (response: Response) => {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json().catch(() => undefined);
  const text = await response.text().catch(() => "");
  return text || undefined;
};

const errorMessage = (payload: unknown, fallback: string) => {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as ApiErrorPayload;
  return value.error ?? value.message ?? fallback;
};

export const createSymposiumApiClient = (fetchImpl: FetchLike = globalThis.fetch.bind(globalThis)) => {
  const request = async <T>(path: string, options: SymposiumApiRequestOptions = {}): Promise<T> => {
    const headers = new Headers(options.headers);
    const hasBody = options.body !== undefined;
    if (hasBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);

    let response: Response;
    try {
      response = await fetchImpl(path, {
        method: options.method ?? "GET",
        headers,
        body: hasBody ? JSON.stringify(options.body) : undefined,
        cache: options.cache,
        signal: options.signal
      });
    } catch (cause) {
      throw new SymposiumApiError("Could not reach the live service.", { cause });
    }

    const payload = await parseResponseBody(response);
    if (!response.ok) {
      throw new SymposiumApiError(errorMessage(payload, `Live request failed (${response.status}).`), {
        status: response.status,
        payload
      });
    }
    return payload as T;
  };

  return { request };
};

export const symposiumApi = createSymposiumApiClient();

export const createClientMutationId = (scope: string) =>
  `symposium:${scope}:${
    globalThis.crypto?.randomUUID?.() ??
    `mutation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }`;

export const createRetryMutationRegistry = () => {
  const keys = new Map<string, string>();

  const acquire = (scope: string, fingerprint: string) => {
    const fingerprintKey = `${scope}:${fingerprint}`;
    const existing = keys.get(fingerprintKey);
    if (existing) return { fingerprintKey, idempotencyKey: existing };
    const idempotencyKey = createClientMutationId(scope);
    keys.set(fingerprintKey, idempotencyKey);
    return { fingerprintKey, idempotencyKey };
  };

  return {
    acquire,
    clear: (fingerprintKey: string) => keys.delete(fingerprintKey),
    size: () => keys.size
  };
};

export const shouldRetainRetryMutation = (error: unknown) =>
  error instanceof SymposiumApiError && (error.status === null || error.status >= 500 || error.status === 409);
