import {
  createCommentInputSchema,
  createPostInputSchema,
  updateCommentInputSchema,
  updatePostInputSchema
} from "@/packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";

export type SymposiumApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type SymposiumNextBoundary =
  | "non-api"
  | "auth-sync"
  | "local-attachment"
  | "protected-assistant-attachment"
  | "protected-message-attachment"
  | "protected-opportunity-attachment"
  | "protected-workspace-attachment";

export type SymposiumApiRouteMapping = {
  actorHandle: string | null;
  body: unknown;
  boundary: SymposiumNextBoundary | null;
  livePath: string | null;
  method: SymposiumApiMethod;
};

const apiOrigin = "https://symposium.invalid";
const sourceUrl = (path: string) => {
  try {
    return new URL(path, apiOrigin);
  } catch {
    return null;
  }
};
export const normalizeSymposiumBackendUrl = (value?: string | null) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.origin + url.pathname.replace(/\/$/, "");
  } catch {
    return null;
  }
};

export const symposiumApiActorHandle = (path: string, body: unknown) => {
  if (body && typeof body === "object") {
    const payload = body as { actorHandle?: unknown; authorHandle?: unknown; handle?: unknown };
    if (typeof payload.actorHandle === "string" && payload.actorHandle) return payload.actorHandle;
    const pathname = sourceUrl(path)?.pathname;
    if (
      typeof payload.authorHandle === "string" &&
      payload.authorHandle &&
      (pathname === "/api/posts" || /^\/api\/posts\/[^/]+\/comments$/.test(pathname ?? ""))
    ) {
      return payload.authorHandle;
    }
    if (pathname === "/api/profiles" && typeof payload.handle === "string" && payload.handle) {
      return payload.handle;
    }
  }
  return sourceUrl(path)?.searchParams.get("actorHandle") ?? null;
};

const withoutActorHandle = (body: unknown) => {
  if (!body || typeof body !== "object" || Array.isArray(body) || !("actorHandle" in body)) return body;
  const { actorHandle: _actorHandle, ...payload } = body as Record<string, unknown>;
  return payload;
};

const preservesLegacyActorBody = (pathname: string, method: SymposiumApiMethod) =>
  (method === "POST" &&
    (pathname === "/api/messages" || pathname === "/api/conversations/groups")) ||
  (method === "DELETE" && /^\/api\/profiles\/[^/]+\/follow$/.test(pathname));

const decodePathSegment = (value: string) => {
  try { return decodeURIComponent(value); }
  catch { return value; }
};

type SafeParser = {
  safeParse: (value: unknown) => { success: true; data: unknown } | { success: false };
};
const postBodySchemas: Array<[SymposiumApiMethod, RegExp, SafeParser]> = [
  ["POST", /^\/api\/posts$/, createPostInputSchema],
  ["PATCH", /^\/api\/posts\/[^/]+$/, updatePostInputSchema],
  ["POST", /^\/api\/posts\/[^/]+\/comments$/, createCommentInputSchema],
  ["PATCH", /^\/api\/posts\/[^/]+\/comments\/[^/]+$/, updateCommentInputSchema]
];
const canonicalPostBody = (pathname: string, method: SymposiumApiMethod, body: unknown) => {
  const schema = postBodySchemas.find(([candidate, pattern]) =>
    candidate === method && pattern.test(pathname)
  )?.[2];
  if (!schema) return body;
  const suppliedLegacyAttachments =
    body && typeof body === "object" && "attachments" in body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return body;
  const data = parsed.data as Record<string, unknown>;
  if (pathname === "/api/posts") {
    data.attachmentIds ??= Array.isArray(data.attachments)
      ? data.attachments.map((attachment) => (attachment as { id: unknown }).id)
      : [];
    if (!suppliedLegacyAttachments) delete data.attachments;
  }
  return method === "POST" && /\/comments$/.test(pathname)
    ? { ...data, parentId: data.parentId ?? null }
    : data;
};

const protectedAttachmentContracts: Array<[RegExp, SymposiumNextBoundary, string]> = [
  [/^\/api\/assistant-attachments\/([^/]+)$/, "protected-assistant-attachment", "/v1/assistant-attachments/$1/access"],
  [/^\/api\/message-attachments\/([^/]+)$/, "protected-message-attachment", "/v1/message-attachments/$1/access"],
  [/^\/api\/opportunity-attachments\/([^/]+)$/, "protected-opportunity-attachment", "/v1/opportunity-attachments/$1/access"],
  [/^\/api\/workspace\/attachments\/([^/]+)$/, "protected-workspace-attachment", "/v1/workspace/attachments/$1/access"]
];
const protectedAttachment = (pathname: string) => {
  for (const [pattern, boundary, target] of protectedAttachmentContracts) {
    if (pattern.test(pathname)) {
      return { boundary, livePath: pathname.replace(pattern, target) };
    }
  }
  return null;
};

export const mapSymposiumApiRoute = (
  path: string,
  input: { body?: unknown; method?: SymposiumApiMethod } = {}
): SymposiumApiRouteMapping => {
  const method = input.method ?? "GET";
  const actorHandle = symposiumApiActorHandle(path, input.body);
  const source = sourceUrl(path);
  if (!path.startsWith("/api/") || !source?.pathname.startsWith("/api/")) {
    return {
      actorHandle,
      body: input.body,
      boundary: "non-api",
      livePath: null,
      method
    };
  }

  const postFamily =
    /^\/api\/posts(?:\/|$)/.test(source.pathname) &&
    !/^\/api\/posts\/[^/]+\/opportunity(?:\/|$)/.test(source.pathname);
  let body = canonicalPostBody(
    source.pathname,
    method,
    postFamily || preservesLegacyActorBody(source.pathname, method)
      ? input.body
      : withoutActorHandle(input.body)
  );
  let boundary: SymposiumNextBoundary | null = null;
  let livePath = source.pathname.replace(/^\/api\//, "/v1/");
  let preserveSearch = true;
  let resolvedMethod = method;

  if (source.pathname === "/api/auth/sync") {
    boundary = "auth-sync";
    preserveSearch = false;
  }
  if (source.pathname.startsWith("/api/attachments/local")) {
    boundary = "local-attachment";
    livePath = "";
    preserveSearch = false;
  }
  const protectedRoute = protectedAttachment(source.pathname);
  if (protectedRoute) {
    boundary = protectedRoute.boundary;
    livePath = protectedRoute.livePath;
    preserveSearch = false;
  }

  const membership = source.pathname.match(/^\/api\/communities\/([^/]+)\/membership$/);
  if (membership && method === "POST" && body && typeof body === "object") {
    const action = (body as { action?: unknown }).action;
    if (action === "join") livePath = `/v1/communities/${membership[1]}/join`;
    if (action === "access") livePath = `/v1/communities/${membership[1]}/access`;
    if (action === "leave") {
      livePath = `/v1/communities/${membership[1]}/membership`;
      resolvedMethod = "DELETE";
    }
    body = {};
  }

  const profileFollow = source.pathname.match(/^\/api\/profiles\/([^/]+)\/follow$/);
  if (profileFollow && (method === "POST" || method === "DELETE")) {
    const followBody = body && typeof body === "object"
      ? body as Record<string, unknown>
      : {};
    const targetHandle = cleanHandle(decodePathSegment(profileFollow[1]));
    livePath = `/v1/profiles/${encodeURIComponent(targetHandle)}/follow`;
    body = method === "POST"
      ? { targetHandle, status: followBody.status ?? "active" }
      : { ...followBody, targetHandle };
  }

  const publication = source.pathname.match(/^\/api\/workspace\/documents\/([^/]+)\/publish$/);
  if (publication && method === "POST") {
    const publicationBody = body && typeof body === "object"
      ? body as Record<string, unknown>
      : {};
    livePath = "/v1/notes/publish";
    body = {
      noteId: decodePathSegment(publication[1]),
      ...(publicationBody.expectedRevision === undefined
        ? {}
        : { expectedRevision: publicationBody.expectedRevision }),
      ...(publicationBody.publicationTarget === undefined
        ? {}
        : { publicationTarget: publicationBody.publicationTarget }),
      visibility: "public"
    };
  }

  const view = source.pathname.match(
    /^\/api\/posts\/([^/]+)(?:\/comments\/([^/]+))?\/actions$/
  );
  if (
    view &&
    method === "POST" &&
    body &&
    typeof body === "object" &&
    (body as { action?: unknown }).action === "read"
  ) {
    livePath = view[2]
      ? `/v1/posts/${view[1]}/comments/${view[2]}/views`
      : `/v1/posts/${view[1]}/views`;
  }

  return {
    actorHandle,
    body,
    boundary,
    livePath: livePath
      ? `${livePath}${preserveSearch
        ? (() => {
            const search = new URLSearchParams(source.searchParams);
            search.delete("actorHandle");
            return search.size ? `?${search}` : "";
          })()
        : ""}`
      : null,
    method: resolvedMethod
  };
};
