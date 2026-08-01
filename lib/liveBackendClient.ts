import { auth } from "@clerk/nextjs/server";
import { liveBackendUnavailableResponse, localDataFallbackAllowed } from "@/lib/runtimeSafety";
import {
  mapSymposiumApiRoute,
  normalizeSymposiumBackendUrl,
  type SymposiumApiMethod
} from "@/lib/symposiumApiRoute";

const backendUrl = normalizeSymposiumBackendUrl(process.env.SYMPOSIUM_API_URL);
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

type LiveBackendOptions = {
  method?: SymposiumApiMethod;
  body?: unknown;
  actorHandle?: string;
  idempotencyKey?: string;
};

type LiveBackendDependencies = {
  backendUrl?: string | null;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  getToken?: () => Promise<string | null>;
  localFallbackAllowed?: () => boolean;
  reportError?: (...values: unknown[]) => void;
};

type LiveApiForwardOptions = {
  actorHandle?: string | null;
  body?: unknown;
  forwardIdempotency?: boolean;
  sourcePath?: string;
};

export const liveBackendPath = (path: string) => (backendUrl ? `${backendUrl}${path}` : null);

export const liveBackendResponseHeaders = (response: Response, fallbackContentType = "application/json") => {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": response.headers.get("content-type") ?? fallbackContentType
  });
  const varyCandidates = response.headers.get("vary")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  varyCandidates.push("Authorization", "Cookie");
  const seenVary = new Set<string>();
  headers.set(
    "Vary",
    varyCandidates
      .filter((value) => {
        const normalized = value.toLowerCase();
        if (seenVary.has(normalized)) return false;
        seenVary.add(normalized);
        return true;
      })
      .join(", ")
  );

  const requestId = response.headers.get("x-request-id");
  if (requestId) headers.set("X-Request-Id", requestId);
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return headers;
};

const responseMustNotHaveBody = (status: number) => [204, 205, 304].includes(status);

export const createLiveBackendProxy = (dependencies: LiveBackendDependencies = {}) => {
  const configuredBackendUrl = normalizeSymposiumBackendUrl(dependencies.backendUrl);
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const getToken = dependencies.getToken ?? (async () =>
    clerkEnabled ? await (await auth()).getToken().catch(() => null) : null);
  const fallbackAllowed = dependencies.localFallbackAllowed ?? localDataFallbackAllowed;
  const reportError = dependencies.reportError ?? console.error;

  return async (path: string, options: LiveBackendOptions = {}) => {
    if (!configuredBackendUrl) {
      if (fallbackAllowed()) return null;

      reportError("SYMPOSIUM_API_URL is required when running the Next application in production.");
      return liveBackendUnavailableResponse();
    }

    try {
      const method = options.method ?? "GET";
      const token = await getToken().catch(() => null);
      const response = await fetchImpl(`${configuredBackendUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.actorHandle ? { "x-symposium-handle": options.actorHandle } : {}),
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store"
      });
      const text = responseMustNotHaveBody(response.status)
        ? null
        : await response.text();
      return new Response(text, {
        status: response.status,
        headers: liveBackendResponseHeaders(response)
      });
    } catch (error) {
      reportError("SYMPOSIUM live backend unavailable.", error);
      return liveBackendUnavailableResponse();
    }
  };
};

export const createLiveApiForwarder = (dependencies: LiveBackendDependencies = {}) => {
  const proxy = createLiveBackendProxy(dependencies);
  return async (request: Request, options: LiveApiForwardOptions = {}) => {
    const sourceUrl = new URL(request.url);
    const sourcePath = options.sourcePath ?? `${sourceUrl.pathname}${sourceUrl.search}`;
    const mapping = mapSymposiumApiRoute(sourcePath, {
      body: options.body,
      method: request.method as SymposiumApiMethod
    });
    if (!mapping.livePath) return null;
    return proxy(mapping.livePath, {
      actorHandle: options.actorHandle ??
        mapping.actorHandle ??
        request.headers.get("x-symposium-handle") ??
        undefined,
      body: mapping.body,
      idempotencyKey: options.forwardIdempotency === false
        ? undefined
        : request.headers.get("idempotency-key") ?? undefined,
      method: mapping.method
    });
  };
};

export const proxyLiveApiRequest = createLiveApiForwarder({ backendUrl });
