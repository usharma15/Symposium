import { deleteComment, getSnapshot, updateComment, type UpdateCommentInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import {
  deleteLocalOwnerAttachments,
  LocalAttachmentStoreError,
  replaceLocalOwnerAttachments
} from "@/lib/localAttachmentStore";
import { canManageComment, findCommentInTree, isDeletedComment } from "@/lib/symposiumCore";
import { ContentQuoteError, resolveLocalContentQuote } from "@/lib/contentQuotes";
import { contentQuoteSourceSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string; commentId: string }>;
};

export async function PATCH(request: Request, context: Context) {
  const { id, commentId } = await context.params;
  const body = await readJson<Partial<UpdateCommentInput> & {
    actorHandle?: string;
    attachmentIds?: unknown[];
    expectedEditedAt?: string | null;
    quoteSource?: unknown;
  }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const input: UpdateCommentInput = {
    body: String(body.body ?? "").trim()
  };

  if (!input.body) {
    return jsonError("Comment body is required.", 400);
  }

  const actorHandle = body.actorHandle ? String(body.actorHandle) : undefined;
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map((attachmentId) => String(attachmentId))
    : undefined;
  const quoteSource = body.quoteSource === undefined || body.quoteSource === null
    ? body.quoteSource
    : contentQuoteSourceSchema.safeParse(body.quoteSource);
  if (quoteSource && "success" in quoteSource && !quoteSource.success) {
    return jsonError("Choose an available post or comment to quote.", 400);
  }
  const parsedQuoteSource = quoteSource && "success" in quoteSource ? quoteSource.data : quoteSource;
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const live = await proxyLiveBackend(`/v1/posts/${id}/comments/${commentId}`, {
    method: "PATCH",
    body: { ...input, actorHandle, attachmentIds, quoteSource: parsedQuoteSource, expectedEditedAt: body.expectedEditedAt },
    actorHandle,
    idempotencyKey
  });
  if (live) return live;

  try {
    const snapshot = await getSnapshot();
    const existing = snapshot.items.find((item) => item.id === id);
    const existingComment = existing ? findCommentInTree(existing.comments, commentId) : null;
    if (
      !existing ||
      !existingComment ||
      isDeletedComment(existingComment) ||
      !canManageComment(existingComment, actorHandle ?? "")
    ) {
      return jsonError("Comment not found or cannot be edited by this profile.", 404);
    }
    if (attachmentIds?.length && (existing.room === "office" || existing.kind === "draft")) {
      return jsonError("Private comment attachments require protected delivery before they can be published.", 412);
    }
    if ((attachmentIds || body.quoteSource !== undefined) && body.expectedEditedAt === undefined) {
      return jsonError("The current comment edit version is required when changing attachments or quotes.", 400);
    }
    if (body.expectedEditedAt !== undefined && (existingComment.editedAt ?? null) !== body.expectedEditedAt) {
      return jsonError("This comment changed after editing began. Refresh it before saving again.", 409);
    }
    const attachments = attachmentIds
      ? await replaceLocalOwnerAttachments({
          actorHandle,
          attachmentIds,
          ownerId: commentId,
          ownerType: "comment"
        })
      : undefined;
    const quote = body.quoteSource === undefined
      ? undefined
      : parsedQuoteSource === null
        ? null
        : resolveLocalContentQuote(snapshot.items, parsedQuoteSource, { ownerId: commentId, ownerType: "comment" });
    const item = await updateComment(id, commentId, { ...input, attachments, quote }, actorHandle ?? "");
    if (!item) {
      return jsonError("Comment not found or cannot be edited by this profile.", 404);
    }

    return Response.json({ item });
  } catch (error) {
    if (error instanceof ContentQuoteError) return jsonError(error.message, error.status);
    if (error instanceof LocalAttachmentStoreError) return jsonError(error.message, error.status);
    throw error;
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id, commentId } = await context.params;
  const body = await readJson<{ actorHandle?: string }>(request);
  const actorHandle = body?.actorHandle ? String(body.actorHandle) : undefined;
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;

  const live = await proxyLiveBackend(`/v1/posts/${id}/comments/${commentId}`, {
    method: "DELETE",
    body: { actorHandle },
    actorHandle,
    idempotencyKey
  });
  if (live) return live;

  const item = await deleteComment(id, commentId, actorHandle ?? "");
  if (!item) {
    return jsonError("Comment not found or cannot be deleted by this profile.", 404);
  }
  await deleteLocalOwnerAttachments("comment", commentId);

  return Response.json({ item, deleted: { id: commentId } });
}
