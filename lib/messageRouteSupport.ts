import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import {
  compatibilityMethodNotAllowedResponse,
  compatibilityNotFoundResponse,
  compatibilityRequestMethod,
  type NextCompatibilityContract
} from "@/lib/nextCompatibilityRoute";
import { liveBackendUnavailableResponse } from "@/lib/runtimeSafety";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";
import { defaultNotificationPreferences } from "@/apps/api/src/services/notificationAggregation";

type MessageProxyOptions = {
  body?: unknown;
  forward?: typeof proxyLiveApiRequest;
  localFallback?: unknown;
};

export const messageRequestBody = async (request: Request) =>
  request.json().catch(() => ({})) as Promise<Record<string, unknown>>;

export const proxyMessageRequest = async (
  request: Request,
  options: MessageProxyOptions = {}
) => {
  const body = options.body;
  const bodyActorHandle = body && typeof body === "object" && "actorHandle" in body
    ? String((body as { actorHandle?: unknown }).actorHandle ?? "")
    : undefined;
  const live = await (options.forward ?? proxyLiveApiRequest)(request, {
    body,
    actorHandle: workspaceActorHandle(request, bodyActorHandle)
  });
  if (live) return live;
  if (options.localFallback !== undefined) {
    return Response.json(options.localFallback, {
      headers: { "Cache-Control": "private, no-store", "Vary": "Authorization, Cookie" }
    });
  }
  return liveBackendUnavailableResponse();
};

type MessageCompatibilityContract = NextCompatibilityContract & {
  localFallback?: unknown;
};

const conversationMethods = ["GET", "POST", "PATCH", "DELETE"] as const;
const conversationContracts = [
  {
    id: "conversations",
    path: "/api/conversations",
    methods: ["GET"] as const,
    localFallback: { conversations: [], nextCursor: null }
  },
  {
    id: "conversations.unread",
    path: "/api/conversations/unread",
    methods: ["GET"] as const,
    localFallback: { unreadCount: 0 }
  },
  {
    id: "conversations.groups",
    path: "/api/conversations/groups",
    methods: ["POST"] as const
  }
] as const;

const notificationContracts = [
  {
    id: "notifications",
    path: "/api/notifications",
    methods: ["GET"] as const,
    localFallback: { notifications: [], unreadCount: 0, nextCursor: null }
  },
  {
    id: "notifications.unread",
    path: "/api/notifications/unread",
    methods: ["GET"] as const,
    localFallback: { unreadCount: 0 }
  },
  {
    id: "notifications.read",
    path: "/api/notifications/read",
    methods: ["POST"] as const
  },
  {
    id: "notifications.archive",
    path: "/api/notifications/archive",
    methods: ["POST"] as const
  },
  {
    id: "notifications.preferences",
    path: "/api/notifications/preferences",
    methods: ["GET", "PATCH"] as const,
    localFallback: defaultNotificationPreferences()
  }
] as const;

export const conversationCompatibilityContractCount =
  conversationContracts.reduce((count, contract) => count + contract.methods.length, 0) +
  conversationMethods.length;
export const notificationCompatibilityContractCount =
  notificationContracts.reduce((count, contract) => count + contract.methods.length, 0);

export const conversationCompatibilityContractFor = (
  pathname: string
): MessageCompatibilityContract | null => {
  const exact = conversationContracts.find((contract) => contract.path === pathname);
  if (exact) return exact;
  if (/^\/api\/conversations\/.+/.test(pathname)) {
    return { id: "conversations.resource", methods: conversationMethods };
  }
  return null;
};

export const notificationCompatibilityContractFor = (
  pathname: string
): MessageCompatibilityContract | null =>
  notificationContracts.find((contract) => contract.path === pathname) ?? null;

type MessageCompatibilityDependencies = {
  forward?: typeof proxyLiveApiRequest;
};

const dispatchMessageCompatibilityRoute = async (
  request: Request,
  resolveContract: (pathname: string) => MessageCompatibilityContract | null,
  dependencies: MessageCompatibilityDependencies
) => {
  const contract = resolveContract(new URL(request.url).pathname);
  if (!contract) return compatibilityNotFoundResponse();

  const method = compatibilityRequestMethod(request);
  if (!contract.methods.some((candidate) => candidate === method)) {
    return compatibilityMethodNotAllowedResponse(contract.methods);
  }

  return proxyMessageRequest(request, {
    ...(method === "GET" ? {} : { body: await messageRequestBody(request) }),
    ...(contract.localFallback === undefined
      ? {}
      : { localFallback: contract.localFallback }),
    ...(dependencies.forward
      ? { forward: dependencies.forward }
      : {})
  });
};

export const conversationCompatibilityRoute = (
  request: Request,
  dependencies: MessageCompatibilityDependencies = {}
) => dispatchMessageCompatibilityRoute(
  request,
  conversationCompatibilityContractFor,
  dependencies
);

export const notificationCompatibilityRoute = (
  request: Request,
  dependencies: MessageCompatibilityDependencies = {}
) => dispatchMessageCompatibilityRoute(
  request,
  notificationCompatibilityContractFor,
  dependencies
);
