import { auth } from "@clerk/nextjs/server";

const backendUrl = process.env.SYMPOSIUM_API_URL?.replace(/\/$/, "");
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

type LiveBackendOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  actorHandle?: string;
};

export const hasLiveBackend = Boolean(backendUrl);

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
