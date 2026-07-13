import { jsonError, readJson } from "@/lib/api";
import { addComment, createPost } from "@/lib/dataStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { getLocalWorkspaceRevision, markLocalWorkspacePublished } from "@/lib/localWorkspaceStore";
import { privateWorkspaceResponse, workspaceActorHandle, workspaceRouteError } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ noteId: string }> };
type PublishBody = {
  actorHandle?: string;
  expectedRevision?: number;
  publicationTarget?: "paper" | "thought";
};

export async function POST(request: Request, context: Context) {
  const { noteId } = await context.params;
  const body = await readJson<PublishBody>(request);
  const actorHandle = workspaceActorHandle(request, body?.actorHandle);
  const payload = {
    noteId,
    expectedRevision: body?.expectedRevision,
    publicationTarget: body?.publicationTarget,
    visibility: "public" as const
  };
  const live = await proxyLiveBackend("/v1/notes/publish", {
    method: "POST",
    body: payload,
    actorHandle,
    idempotencyKey: request.headers.get("Idempotency-Key") ?? undefined
  });
  if (live) return live;

  try {
    if (!body?.expectedRevision) return jsonError("Publishing requires the exact draft revision.", 428);
    const { document, checkpoint } = await getLocalWorkspaceRevision(noteId, body.expectedRevision, actorHandle);
    if (!document.body.trim()) return jsonError("Add some content before publishing this draft.", 400);
    if (checkpoint.attachmentIds.length) {
      return jsonError("Private draft attachments remain protected. Publishing their public copies will be activated in the collaboration pass.", 412);
    }
    const target = document.kind === "note" ? body.publicationTarget ?? document.publicationTarget : document.kind;
    if (target === "paper" || target === "thought") {
      const item = await createPost({
        title: document.title,
        body: document.body,
        document: document.document,
        kind: target,
        room: target === "paper" ? "library" : "amphitheater",
        attachments: []
      }, actorHandle);
      await markLocalWorkspacePublished(noteId, document.revision, item.id, actorHandle);
      return privateWorkspaceResponse({
        item,
        publication: {
          noteId,
          revision: document.revision,
          checkpointId: checkpoint.checkpointId,
          target,
          postId: item.id,
          visibility: "public"
        }
      });
    }
    if (target !== "comment" && target !== "reply") {
      return jsonError("Choose whether this generic note becomes a Paper or a Thought.", 400);
    }
    if (!document.targetId) return jsonError("Link this draft to its destination before publishing.", 400);
    const separator = document.targetId.indexOf(":");
    const postId = target === "reply" && separator > 0 ? document.targetId.slice(0, separator) : document.targetId;
    const parentId = target === "reply" && separator > 0 ? document.targetId.slice(separator + 1) : null;
    if (target === "reply" && !parentId) return jsonError("A reply draft must be linked as post-id:comment-id.", 400);
    const result = await addComment(postId, {
      body: document.body,
      document: document.document,
      stance: document.title,
      parentId,
      attachments: []
    }, actorHandle);
    await markLocalWorkspacePublished(noteId, document.revision, postId, actorHandle);
    return privateWorkspaceResponse({
      ...result,
      publication: {
        noteId,
        revision: document.revision,
        checkpointId: checkpoint.checkpointId,
        target,
        postId,
        commentId: result?.comment?.id ?? null,
        visibility: "public"
      }
    });
  } catch (error) {
    return workspaceRouteError(error);
  }
}
