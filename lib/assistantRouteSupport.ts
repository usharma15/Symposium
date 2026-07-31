import { readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import {
  compatibilityMethodNotAllowedResponse,
  compatibilityNotFoundResponse,
  compatibilityRequestMethod,
  type NextCompatibilityContract
} from "@/lib/nextCompatibilityRoute";
import { workspaceActorHandle } from "@/lib/workspaceRouteSupport";

type AssistantRequestBody = Record<string, unknown> & {
  actorHandle?: string;
};

const unavailableResponse = (body: unknown) =>
  Response.json(typeof body === "string" ? { error: body } : body, {
    status: 503,
    headers: { "Cache-Control": "no-store" }
  });

type AssistantCompatibilityContract = NextCompatibilityContract & {
  unavailableBody: unknown;
};

const get = ["GET"] as const;
const post = ["POST"] as const;
const projectMutation = ["PATCH", "DELETE"] as const;
const threadMethods = ["GET", "POST", "PATCH", "DELETE"] as const;
const liveWorkspace = "AI Assistant actions require the live workspace.";
const assistantContracts = [
  { id: "actions.office-draft-edits", path: "/api/assistant/actions/office-draft-edits", methods: post, unavailableBody: liveWorkspace },
  { id: "actions.office-draft-edits.undo", path: "/api/assistant/actions/office-draft-edits/undo", methods: post, unavailableBody: liveWorkspace },
  { id: "actions.office-note-drafts", path: "/api/assistant/actions/office-note-drafts", methods: post, unavailableBody: liveWorkspace },
  { id: "actions.office-post-drafts", path: "/api/assistant/actions/office-post-drafts", methods: post, unavailableBody: liveWorkspace },
  { id: "content-translations", path: "/api/assistant/content-translations", methods: post, unavailableBody: "Content translation requires the cost-controlled live backend." },
  { id: "conversations", path: "/api/assistant/conversations", methods: get, unavailableBody: { threads: [], nextCursor: null } },
  { id: "document-translations", path: "/api/assistant/document-translations", methods: post, unavailableBody: "Document translation requires the cost-controlled live backend." },
  { id: "messages", path: "/api/assistant/messages", methods: post, unavailableBody: "The AI Tablet requires the cost-controlled live backend." },
  { id: "projects", path: "/api/assistant/projects", methods: ["GET", "POST"] as const, unavailableBody: { projects: [] } },
  { id: "quick-notes", path: "/api/assistant/quick-notes", methods: post, unavailableBody: "AI Quick Notes require the live workspace." },
  { id: "quota", path: "/api/assistant/quota", methods: get, unavailableBody: "The AI Tablet quota requires the cost-controlled live backend." }
] as const;

export const assistantCompatibilityContractCount =
  assistantContracts.reduce((count, contract) => count + contract.methods.length, 0) +
  projectMutation.length + threadMethods.length;

export const assistantCompatibilityContractFor = (
  pathname: string
): AssistantCompatibilityContract | null => {
  const exact = assistantContracts.find((contract) => contract.path === pathname);
  if (exact) {
    if (exact.id === "projects") {
      return {
        id: exact.id,
        methods: exact.methods,
        unavailableBody: exact.unavailableBody
      };
    }
    return exact;
  }
  if (/^\/api\/assistant\/projects\/[^/]+$/.test(pathname)) {
    return {
      id: "projects.resource",
      methods: projectMutation,
      unavailableBody: "Assistant Projects require the live backend."
    };
  }
  if (/^\/api\/assistant\/conversations\/.+/.test(pathname)) {
    return {
      id: "conversations.resource",
      methods: threadMethods,
      unavailableBody: "Research threads require the cost-controlled live backend."
    };
  }
  return null;
};

type AssistantCompatibilityDependencies = {
  forward?: typeof proxyLiveApiRequest;
};

export const assistantCompatibilityRoute = async (
  request: Request,
  dependencies: AssistantCompatibilityDependencies = {}
) => {
  const contract = assistantCompatibilityContractFor(new URL(request.url).pathname);
  if (!contract) return compatibilityNotFoundResponse();

  const method = compatibilityRequestMethod(request);
  if (!contract.methods.some((candidate) => candidate === method)) {
    return compatibilityMethodNotAllowedResponse(contract.methods);
  }

  const forward = dependencies.forward ?? proxyLiveApiRequest;
  if (method === "GET") {
    const live = await forward(request, {
      actorHandle: workspaceActorHandle(request)
    });
    return live ?? unavailableResponse(contract.unavailableBody);
  }

  const body = await readJson<AssistantRequestBody>(request);
  const live = await forward(request, {
    actorHandle: workspaceActorHandle(request, body?.actorHandle),
    body: { ...body }
  });
  return live ?? unavailableResponse(
    contract.id === "projects" && method === "POST"
      ? "Assistant Projects require the live backend."
      : contract.unavailableBody
  );
};
