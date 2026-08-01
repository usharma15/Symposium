import {
  mapSymposiumApiRoute,
  normalizeSymposiumBackendUrl,
  symposiumApiActorHandle
} from "@/lib/symposiumApiRoute";

export type SymposiumApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  actorHandle?: string;
  cache?: RequestCache;
  idempotencyKey?: string;
  headers?: HeadersInit;
  keepalive?: boolean;
  signal?: AbortSignal;
};

export type SymposiumApiRuntime = {
  backendUrl?: string | null;
  getAccessToken?: () => Promise<string | null>;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

type ResolvedRequest = {
  body: unknown;
  direct: boolean;
  input: string;
  method: NonNullable<SymposiumApiRequestOptions["method"]>;
};

export const resolveSymposiumApiRequest = (
  path: string,
  options: SymposiumApiRequestOptions,
  backendUrl?: string | null
): ResolvedRequest => {
  const method = options.method ?? "GET";
  const directBackendUrl = normalizeSymposiumBackendUrl(backendUrl);
  const mappingBody =
    options.actorHandle &&
    options.body &&
    typeof options.body === "object" &&
    !Array.isArray(options.body)
      ? { ...options.body, actorHandle: options.actorHandle }
      : options.body;
  const mapping = mapSymposiumApiRoute(path, { body: mappingBody, method });
  if (
    !directBackendUrl ||
    mapping.boundary !== null ||
    !mapping.livePath
  ) {
    return { body: options.body, direct: false, input: path, method };
  }
  return {
    body: mapping.body,
    direct: true,
    input: `${directBackendUrl}${mapping.livePath}`,
    method: mapping.method
  };
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

export const createSymposiumApiClient = (
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  initialRuntime: SymposiumApiRuntime = {}
) => {
  let runtime = initialRuntime;

  const configure = (next: SymposiumApiRuntime) => {
    runtime = next;
  };

  const request = async <T>(path: string, options: SymposiumApiRequestOptions = {}): Promise<T> => {
    const sourceActorHandle =
      options.actorHandle ?? symposiumApiActorHandle(path, options.body);
    const resolved = resolveSymposiumApiRequest(path, options, runtime.backendUrl);
    const headers = new Headers(options.headers);
    const hasBody = resolved.body !== undefined;
    if (hasBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);

    if (resolved.direct) {
      const token = await runtime.getAccessToken?.().catch(() => null);
      if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
      if (!token && sourceActorHandle && !headers.has("x-symposium-handle")) {
        headers.set("x-symposium-handle", sourceActorHandle);
      }
    } else if (sourceActorHandle && !headers.has("x-symposium-handle")) {
      headers.set("x-symposium-handle", sourceActorHandle);
    }

    const fetchRequest = (input: string, direct: boolean) => {
      const transportBody = direct
        ? resolved.body
        : options.actorHandle &&
            options.body &&
            typeof options.body === "object" &&
            !Array.isArray(options.body)
          ? { ...options.body, actorHandle: options.actorHandle }
          : options.body;
      return fetchImpl(input, {
        method: direct ? resolved.method : options.method ?? "GET",
        headers: direct ? headers : (() => {
          const fallbackHeaders = new Headers(headers);
          fallbackHeaders.delete("Authorization");
          if (sourceActorHandle && !fallbackHeaders.has("x-symposium-handle")) {
            fallbackHeaders.set("x-symposium-handle", sourceActorHandle);
          }
          return fallbackHeaders;
        })(),
        body: hasBody ? JSON.stringify(transportBody) : undefined,
        cache: options.cache,
        keepalive: options.keepalive,
        signal: options.signal
      });
    };

    let response: Response;
    try {
      response = await fetchRequest(resolved.input, resolved.direct);
    } catch (cause) {
      const mutationCanReplay = resolved.method === "GET" || Boolean(options.idempotencyKey);
      if (!resolved.direct || !mutationCanReplay || options.signal?.aborted) {
        throw new SymposiumApiError("Could not reach the live service.", { cause });
      }
      try {
        response = await fetchRequest(path, false);
      } catch (fallbackCause) {
        throw new SymposiumApiError("Could not reach the live service.", { cause: fallbackCause });
      }
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

  const uploadBinary = async <T>(
    path: string,
    body: Blob,
    options: { actorHandle?: string; signal?: AbortSignal } = {}
  ): Promise<T> => {
    const resolved = resolveSymposiumApiRequest(path, { method: "PUT" }, runtime.backendUrl);
    const headers = new Headers({ "Content-Type": "application/octet-stream" });
    if (resolved.direct) {
      const token = await runtime.getAccessToken?.().catch(() => null);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      else if (options.actorHandle) headers.set("x-symposium-handle", options.actorHandle);
    }

    let response: Response;
    try {
      response = await fetchImpl(resolved.input, {
        method: "PUT",
        headers,
        body,
        cache: "no-store",
        signal: options.signal
      });
    } catch (cause) {
      throw new SymposiumApiError("Could not reach attachment storage.", { cause });
    }
    const payload = await parseResponseBody(response);
    if (!response.ok) {
      throw new SymposiumApiError(errorMessage(payload, `Attachment upload failed (${response.status}).`), {
        status: response.status,
        payload
      });
    }
    return payload as T;
  };

  return { configure, request, uploadBinary };
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
