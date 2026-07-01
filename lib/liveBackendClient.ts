import { auth } from "@clerk/nextjs/server";

const backendUrl = process.env.SYMPOSIUM_API_URL?.replace(/\/$/, "");
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

type LiveBackendOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  actorHandle?: string;
};

export const hasLiveBackend = Boolean(backendUrl);

export const liveBackendPath = (path: string) => (backendUrl ? `${backendUrl}${path}` : null);

export const proxyLiveBackend = async (path: string, options: LiveBackendOptions = {}) => {
  if (!backendUrl) return null;

  try {
    const token = clerkEnabled ? await (await auth()).getToken().catch(() => null) : null;
    const response = await fetch(`${backendUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.actorHandle ? { "x-symposium-handle": options.actorHandle } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json"
      }
    });
  } catch (error) {
    console.error("SYMPOSIUM live backend unavailable.", error);
    return Response.json(
      {
        error:
          "The SYMPOSIUM live backend is configured but unavailable. Try again once the live service is healthy."
      },
      { status: 503 }
    );
  }
};

export const proxyLiveBackendStream = async (path: string) => {
  const url = liveBackendPath(path);
  if (!url) return null;

  try {
    const token = clerkEnabled ? await (await auth()).getToken().catch(() => null) : null;
    const response = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      cache: "no-store"
    });

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    console.error("SYMPOSIUM live event stream unavailable.", error);
    return null;
  }
};
