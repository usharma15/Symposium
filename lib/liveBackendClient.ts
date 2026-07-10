import { auth } from "@clerk/nextjs/server";
import { liveBackendUnavailableResponse, localDataFallbackAllowed } from "@/lib/runtimeSafety";

const backendUrl = process.env.SYMPOSIUM_API_URL?.replace(/\/$/, "");
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

type LiveBackendOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  actorHandle?: string;
  idempotencyKey?: string;
};

export const hasLiveBackend = Boolean(backendUrl);

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

export const proxyLiveBackend = async (path: string, options: LiveBackendOptions = {}) => {
  if (!backendUrl) {
    if (localDataFallbackAllowed()) return null;

    console.error("SYMPOSIUM_API_URL is required when running the Next application in production.");
    return liveBackendUnavailableResponse();
  }

  try {
    const token = clerkEnabled ? await (await auth()).getToken().catch(() => null) : null;
    const response = await fetch(`${backendUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.actorHandle ? { "x-symposium-handle": options.actorHandle } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: liveBackendResponseHeaders(response)
    });
  } catch (error) {
    console.error("SYMPOSIUM live backend unavailable.", error);
    return liveBackendUnavailableResponse();
  }
};

export const proxyLiveBackendStream = async (path: string) => {
  const url = liveBackendPath(path);
  if (!url) {
    if (localDataFallbackAllowed()) return null;

    console.error("SYMPOSIUM_API_URL is required when running the Next application in production.");
    return liveBackendUnavailableResponse();
  }

  try {
    const token = clerkEnabled ? await (await auth()).getToken().catch(() => null) : null;
    const response = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      cache: "no-store"
    });

    const headers = liveBackendResponseHeaders(response, "text/event-stream; charset=utf-8");
    headers.set("Cache-Control", "no-cache, no-transform");
    headers.set("Connection", "keep-alive");
    headers.set("X-Accel-Buffering", "no");
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    console.error("SYMPOSIUM live event stream unavailable.", error);
    return liveBackendUnavailableResponse();
  }
};
