import { deletePost, getSnapshot, updatePost, type UpdatePostInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import {
  deleteLocalOwnerAttachments,
  LocalAttachmentStoreError,
  replaceLocalOwnerAttachments
} from "@/lib/localAttachmentStore";
import { cleanHandle, isDeletedPost } from "@/lib/symposiumCore";
import { ContentQuoteError, resolveLocalContentQuote } from "@/lib/contentQuotes";
import { contentQuoteSourceSchema } from "@/packages/contracts/src";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<Partial<UpdatePostInput> & {
    actorHandle?: string;
    attachmentIds?: unknown[];
    expectedEditedAt?: string | null;
    quoteSource?: unknown;
  }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const input: UpdatePostInput = {
    title: String(body.title ?? "").trim(),
    body: String(body.body ?? "").trim()
  };

  if (!input.title || !input.body) {
    return jsonError("Title and body are required.", 400);
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
  const live = await proxyLiveBackend(`/v1/posts/${id}`, {
    method: "PATCH",
    body: { ...input, actorHandle, attachmentIds, quoteSource: parsedQuoteSource, expectedEditedAt: body.expectedEditedAt },
    actorHandle,
    idempotencyKey
  });
  if (live) return live;

  try {
    const snapshot = await getSnapshot();
    const existing = snapshot.items.find((item) => item.id === id);
    if (
      !existing ||
      isDeletedPost(existing) ||
      cleanHandle(existing.authorHandle ?? existing.author) !== cleanHandle(actorHandle ?? "")
    ) {
      return jsonError("Post not found or cannot be edited by this profile.", 404);
    }
    if (attachmentIds?.length && (existing.room === "office" || existing.kind === "draft")) {
      return jsonError("Private post attachments require protected delivery before they can be published.", 412);
    }
    if ((attachmentIds || body.quoteSource !== undefined) && body.expectedEditedAt === undefined) {
      return jsonError("The current post edit version is required when changing attachments or quotes.", 400);
    }
    if (body.expectedEditedAt !== undefined && (existing.editedAt ?? null) !== body.expectedEditedAt) {
      return jsonError("This post changed after editing began. Refresh it before saving again.", 409);
    }
    const attachments = attachmentIds
      ? await replaceLocalOwnerAttachments({ actorHandle, attachmentIds, ownerId: id, ownerType: "post" })
      : undefined;
    const quote = body.quoteSource === undefined
      ? undefined
      : parsedQuoteSource === null
        ? null
        : resolveLocalContentQuote(snapshot.items, parsedQuoteSource, { ownerId: id, ownerType: "post" });
    const item = await updatePost(id, { ...input, attachments, quote }, actorHandle ?? "");
    if (!item) {
      return jsonError("Post not found or cannot be edited by this profile.", 404);
    }

    return Response.json({ item });
  } catch (error) {
    if (error instanceof ContentQuoteError) return jsonError(error.message, error.status);
    if (error instanceof LocalAttachmentStoreError) return jsonError(error.message, error.status);
    throw error;
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<{ actorHandle?: string }>(request);
  const actorHandle = body?.actorHandle ? String(body.actorHandle) : undefined;
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;

  const live = await proxyLiveBackend(`/v1/posts/${id}`, {
    method: "DELETE",
    body: { actorHandle },
    actorHandle,
    idempotencyKey
  });
  if (live) return live;

  const item = await deletePost(id, actorHandle ?? "");
  if (!item) {
    return jsonError("Post not found or cannot be deleted by this profile.", 404);
  }

  await Promise.all([
    deleteLocalOwnerAttachments("post", id),
    ...item.comments
      .flatMap(function flatten(comment): typeof item.comments {
        return [comment, ...(comment.replies ?? []).flatMap(flatten)];
      })
      .filter((comment) => Boolean(comment.id))
      .map((comment) => deleteLocalOwnerAttachments("comment", comment.id as string))
  ]);

  return Response.json({ item, deleted: { id: item.id } });
}
