import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  assistantCompatibilityContractCount,
  assistantCompatibilityContractFor,
  assistantCompatibilityRoute
} from "@/lib/assistantRouteSupport";
import {
  conversationCompatibilityContractCount,
  conversationCompatibilityContractFor,
  conversationCompatibilityRoute,
  notificationCompatibilityContractCount,
  notificationCompatibilityContractFor,
  notificationCompatibilityRoute
} from "@/lib/messageRouteSupport";

type ForwardOptions = {
  actorHandle?: string | null;
  body?: unknown;
};

const json = async (response: Response) => response.json() as Promise<Record<string, unknown>>;
const request = (path: string, method = "GET", body?: unknown) =>
  new Request(`https://symposium.example${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

const routeModules = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeModules(absolute);
    return entry.name === "route.ts"
      ? [path.relative(process.cwd(), absolute).replaceAll(path.sep, "/")]
      : [];
  });

const main = async () => {
  assert.equal(assistantCompatibilityContractCount, 18);
  assert.equal(conversationCompatibilityContractCount, 7);
  assert.equal(notificationCompatibilityContractCount, 6);

  const consolidatedModules = new Set([
    "app/api/assistant/[[...segments]]/route.ts",
    "app/api/conversations/[[...segments]]/route.ts",
    "app/api/notifications/[[...segments]]/route.ts"
  ]);
  const protectedBoundaryModules = new Set([
    "app/api/assistant-attachments/[attachmentId]/route.ts",
    "app/api/attachments/local-upload/[attachmentId]/route.ts",
    "app/api/attachments/local/[attachmentId]/[fileName]/route.ts",
    "app/api/auth/sync/route.ts",
    "app/api/events/stream/route.ts",
    "app/api/message-attachments/[attachmentId]/route.ts",
    "app/api/opportunity-attachments/[attachmentId]/route.ts",
    "app/api/workspace/attachments/[attachmentId]/route.ts"
  ]);
  const canonicalOnlyModules = new Set([
    "app/api/blocks/route.ts",
    "app/api/messages/route.ts",
    "app/api/posts/[id]/analytics/route.ts"
  ]);
  const synthesizedPreviewModules = new Set([
    "app/api/events/route.ts",
    "app/api/follows/route.ts",
    "app/api/profiles/[handle]/follow/route.ts",
    "app/api/profiles/[handle]/follows/route.ts"
  ]);
  const classifications = new Map<string, string>();
  for (const file of routeModules(path.join(process.cwd(), "app/api"))) {
    if (consolidatedModules.has(file)) classifications.set(file, "consolidated-compatibility");
    else if (protectedBoundaryModules.has(file)) classifications.set(file, "protected-next-boundary");
    else if (canonicalOnlyModules.has(file)) classifications.set(file, "canonical-only-compatibility");
    else if (synthesizedPreviewModules.has(file)) classifications.set(file, "synthesized-local-preview");
    else {
      const source = readFileSync(file, "utf8");
      assert.match(
        source,
        /(?:local|Local|workspaceRead|workspaceMutation)/,
        `${file} has no named compatibility responsibility.`
      );
      classifications.set(file, "persisted-local-preview");
    }
  }
  assert.equal(classifications.size, 66);
  assert.deepEqual(
    [...classifications.values()].reduce<Record<string, number>>((counts, category) => {
      counts[category] = (counts[category] ?? 0) + 1;
      return counts;
    }, {}),
    {
      "consolidated-compatibility": 3,
      "protected-next-boundary": 8,
      "canonical-only-compatibility": 3,
      "synthesized-local-preview": 4,
      "persisted-local-preview": 48
    }
  );

  const assistantCases = [
    ["/api/assistant/actions/office-draft-edits", "POST", "actions.office-draft-edits"],
    ["/api/assistant/actions/office-draft-edits/undo", "POST", "actions.office-draft-edits.undo"],
    ["/api/assistant/actions/office-note-drafts", "POST", "actions.office-note-drafts"],
    ["/api/assistant/actions/office-post-drafts", "POST", "actions.office-post-drafts"],
    ["/api/assistant/content-translations", "POST", "content-translations"],
    ["/api/assistant/conversations", "GET", "conversations"],
    ["/api/assistant/conversations/thread-1", "GET", "conversations.resource"],
    ["/api/assistant/conversations/thread-1/messages", "POST", "conversations.resource"],
    ["/api/assistant/conversations/thread-1/context", "PATCH", "conversations.resource"],
    ["/api/assistant/conversations/thread-1", "DELETE", "conversations.resource"],
    ["/api/assistant/document-translations", "POST", "document-translations"],
    ["/api/assistant/messages", "POST", "messages"],
    ["/api/assistant/projects", "GET", "projects"],
    ["/api/assistant/projects", "POST", "projects"],
    ["/api/assistant/projects/project-1", "PATCH", "projects.resource"],
    ["/api/assistant/projects/project-1", "DELETE", "projects.resource"],
    ["/api/assistant/quick-notes", "POST", "quick-notes"],
    ["/api/assistant/quota", "GET", "quota"]
  ] as const;
  assert.equal(assistantCases.length, assistantCompatibilityContractCount);
  for (const [path, method, id] of assistantCases) {
    const contract = assistantCompatibilityContractFor(path);
    assert.equal(contract?.id, id);
    assert.equal(contract?.methods.includes(method), true);

    let calls = 0;
    const response = await assistantCompatibilityRoute(
      request(path, method, method === "GET" ? undefined : { actorHandle: "@ada", contract: id }),
      {
        forward: async (incoming, options) => {
          calls += 1;
          assert.equal(new URL(incoming.url).pathname, path);
          assert.equal(incoming.method, method);
          assert.equal(options?.actorHandle, method === "GET" ? "@udayan" : "@ada");
          return Response.json({ contract: id }, { status: 202 });
        }
      }
    );
    assert.equal(response.status, 202);
    assert.equal(calls, 1);
    assert.deepEqual(await json(response), { contract: id });
  }
  assert.equal(assistantCompatibilityContractFor("/api/assistant/projects/project-1/extra"), null);
  assert.equal(assistantCompatibilityContractFor("/api/assistant/unknown"), null);

  const assistantLocal = await assistantCompatibilityRoute(
    request("/api/assistant/conversations"),
    { forward: async () => null }
  );
  assert.equal(assistantLocal.status, 503);
  assert.deepEqual(await json(assistantLocal), { threads: [], nextCursor: null });
  assert.equal(assistantLocal.headers.get("cache-control"), "no-store");

  const assistantMutationLocal = await assistantCompatibilityRoute(
    request("/api/assistant/actions/office-note-drafts", "POST", { actorHandle: "@ada" }),
    { forward: async () => null }
  );
  assert.equal(assistantMutationLocal.status, 503);
  assert.match(String((await json(assistantMutationLocal)).error), /live workspace/);

  const forwarded: Array<{ path: string; options: ForwardOptions }> = [];
  const assistantForward = await assistantCompatibilityRoute(
    request("/api/assistant/projects/project-1", "PATCH", { actorHandle: "@ada", name: "Proof" }),
    {
      forward: async (incoming, options) => {
        forwarded.push({ path: new URL(incoming.url).pathname, options: options ?? {} });
        return Response.json({ forwarded: true }, { status: 202 });
      }
    }
  );
  assert.equal(assistantForward.status, 202);
  assert.deepEqual(forwarded, [{
    path: "/api/assistant/projects/project-1",
    options: { actorHandle: "@ada", body: { actorHandle: "@ada", name: "Proof" } }
  }]);

  const assistantMethod = await assistantCompatibilityRoute(
    request("/api/assistant/quota", "POST"),
    { forward: async () => { throw new Error("must not forward"); } }
  );
  assert.equal(assistantMethod.status, 405);
  assert.equal(assistantMethod.headers.get("allow"), "GET");
  assert.equal(assistantMethod.headers.get("cache-control"), "private, no-store");
  assert.equal(assistantMethod.headers.get("vary"), "Authorization, Cookie");
  const assistantUnknown = await assistantCompatibilityRoute(
    request("/api/assistant/not-real"),
    { forward: async () => { throw new Error("must not forward"); } }
  );
  assert.equal(assistantUnknown.status, 404);
  assert.equal(assistantUnknown.headers.get("cache-control"), "private, no-store");
  assert.equal(assistantUnknown.headers.get("vary"), "Authorization, Cookie");

  const conversationCases = [
    ["/api/conversations", "GET", "conversations"],
    ["/api/conversations/unread", "GET", "conversations.unread"],
    ["/api/conversations/groups", "POST", "conversations.groups"],
    ["/api/conversations/conversation-1/messages", "GET", "conversations.resource"],
    ["/api/conversations/conversation-1/read", "POST", "conversations.resource"],
    ["/api/conversations/conversation-1/draft", "PATCH", "conversations.resource"],
    ["/api/conversations/conversation-1", "DELETE", "conversations.resource"]
  ] as const;
  assert.equal(conversationCases.length, conversationCompatibilityContractCount);
  for (const [path, method, id] of conversationCases) {
    const contract = conversationCompatibilityContractFor(path);
    assert.equal(contract?.id, id);
    assert.equal(contract?.methods.includes(method), true);

    let calls = 0;
    const response = await conversationCompatibilityRoute(
      request(path, method, method === "GET" ? undefined : { actorHandle: "@ada", contract: id }),
      {
        forward: async (incoming) => {
          calls += 1;
          assert.equal(new URL(incoming.url).pathname, path);
          assert.equal(incoming.method, method);
          return Response.json({ contract: id }, { status: 202 });
        }
      }
    );
    assert.equal(response.status, 202);
    assert.equal(calls, 1);
    assert.deepEqual(await json(response), { contract: id });
  }
  assert.equal(conversationCompatibilityContractFor("/api/conversation"), null);

  const conversationLocal = await conversationCompatibilityRoute(
    request("/api/conversations"),
    { forward: async () => null }
  );
  assert.equal(conversationLocal.status, 200);
  assert.deepEqual(await json(conversationLocal), { conversations: [], nextCursor: null });
  assert.equal(conversationLocal.headers.get("cache-control"), "private, no-store");
  assert.equal(conversationLocal.headers.get("vary"), "Authorization, Cookie");

  let conversationForwardBody: unknown;
  const conversationForward = await conversationCompatibilityRoute(
    request("/api/conversations/conversation-1/draft", "PATCH", { actorHandle: "@ada", body: "Draft" }),
    {
      forward: async (_incoming, options) => {
        conversationForwardBody = options?.body;
        return Response.json({ forwarded: true });
      }
    }
  );
  assert.equal(conversationForward.status, 200);
  assert.deepEqual(conversationForwardBody, { actorHandle: "@ada", body: "Draft" });
  const conversationWrongMethod = await conversationCompatibilityRoute(
    request("/api/conversations/unread", "DELETE"),
    { forward: async () => { throw new Error("must not forward"); } }
  );
  assert.equal(conversationWrongMethod.status, 405);
  assert.equal(conversationWrongMethod.headers.get("allow"), "GET");
  assert.equal(conversationWrongMethod.headers.get("cache-control"), "private, no-store");

  const notificationCases = [
    ["/api/notifications", "GET", "notifications"],
    ["/api/notifications/unread", "GET", "notifications.unread"],
    ["/api/notifications/read", "POST", "notifications.read"],
    ["/api/notifications/archive", "POST", "notifications.archive"],
    ["/api/notifications/preferences", "GET", "notifications.preferences"],
    ["/api/notifications/preferences", "PATCH", "notifications.preferences"]
  ] as const;
  assert.equal(notificationCases.length, notificationCompatibilityContractCount);
  for (const [path, method, id] of notificationCases) {
    const contract = notificationCompatibilityContractFor(path);
    assert.equal(contract?.id, id);
    assert.equal(contract?.methods.includes(method), true);

    let calls = 0;
    const response = await notificationCompatibilityRoute(
      request(path, method, method === "GET" ? undefined : { actorHandle: "@ada", contract: id }),
      {
        forward: async (incoming) => {
          calls += 1;
          assert.equal(new URL(incoming.url).pathname, path);
          assert.equal(incoming.method, method);
          return Response.json({ contract: id }, { status: 202 });
        }
      }
    );
    assert.equal(response.status, 202);
    assert.equal(calls, 1);
    assert.deepEqual(await json(response), { contract: id });
  }
  assert.equal(notificationCompatibilityContractFor("/api/notifications/preferences/extra"), null);
  const notificationLocal = await notificationCompatibilityRoute(
    request("/api/notifications"),
    { forward: async () => null }
  );
  assert.deepEqual(await json(notificationLocal), {
    notifications: [],
    unreadCount: 0,
    nextCursor: null
  });
  const notificationMutationLocal = await notificationCompatibilityRoute(
    request("/api/notifications/read", "POST", { actorHandle: "@ada", notificationIds: ["notification-1"] }),
    { forward: async () => null }
  );
  assert.equal(notificationMutationLocal.status, 503);
  const notificationWrongMethod = await notificationCompatibilityRoute(
    request("/api/notifications/archive", "GET"),
    { forward: async () => { throw new Error("must not forward"); } }
  );
  assert.equal(notificationWrongMethod.status, 405);
  assert.equal(notificationWrongMethod.headers.get("allow"), "POST");
  assert.equal(notificationWrongMethod.headers.get("cache-control"), "private, no-store");

  const assistantRoute = readFileSync("app/api/assistant/[[...segments]]/route.ts", "utf8");
  const conversationRoute = readFileSync("app/api/conversations/[[...segments]]/route.ts", "utf8");
  const notificationRoute = readFileSync("app/api/notifications/[[...segments]]/route.ts", "utf8");
  assert.match(assistantRoute, /assistantCompatibilityRoute/);
  assert.match(conversationRoute, /conversationCompatibilityRoute/);
  assert.match(notificationRoute, /notificationCompatibilityRoute/);
  for (const source of [assistantRoute, conversationRoute]) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      assert.match(source, new RegExp(`export const ${method} =`));
    }
  }

  console.log("Canonical Next compatibility route authority checks passed (31 contracts)." );
};

void main();
