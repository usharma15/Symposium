import { addComment, getSnapshot, type CreateCommentInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { randomUUID } from "node:crypto";
import {
  deleteLocalOwnerAttachments,
  LocalAttachmentStoreError,
  replaceLocalOwnerAttachments
} from "@/lib/localAttachmentStore";
import { findCommentInTree, isDeletedPost } from "@/lib/symposiumCore";
import { ContentQuoteError, resolveLocalContentQuote } from "@/lib/contentQuotes";
import { contentQuoteSourceSchema, versionedDocumentSchema } from "@/packages/contracts/src";
import { assertLocalQuoteDestination, localCommunityParticipationAllowed, localQuoteSourceItems } from "@/lib/localCommunityAuthorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<Partial<CreateCommentInput> & {
    attachmentIds?: unknown[];
    actorHandle?: string;
    authorHandle?: string;
    quoteSource?: unknown;
  }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const input: CreateCommentInput = {
    body: String(body.body ?? "").trim(),
    document: body.document === undefined ? undefined : versionedDocumentSchema.safeParse(body.document).data,
    stance: String(body.stance ?? "Comment").trim(),
    parentId: body.parentId ? String(body.parentId) : null
  };
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map((attachmentId) => String(attachmentId))
    : [];
  const quoteSource = body.quoteSource === undefined ? undefined : contentQuoteSourceSchema.safeParse(body.quoteSource);
  if (quoteSource && !quoteSource.success) return jsonError("Choose an available post or comment to quote.", 400);

  if (!input.body) {
    return jsonError("Comment body is required.", 400);
  }
  if (body.document !== undefined && !versionedDocumentSchema.safeParse(body.document).success) {
    return jsonError("The comment document is invalid or unsupported.", 400);
  }

  const liveActorHandle = body.actorHandle ?? body.authorHandle;
  const live = await proxyLiveApiRequest(request, {
    body: { ...input, attachmentIds, quoteSource: quoteSource?.data, authorHandle: body.authorHandle },
    actorHandle: liveActorHandle ? String(liveActorHandle) : undefined,
    sourcePath: `/api/posts/${encodeURIComponent(id)}/comments`
  });
  if (live) return live;

  const commentId = randomUUID();
  try {
    const snapshot = await getSnapshot();
    const existing = snapshot.items.find((item) => item.id === id);
    if (
      !existing ||
      isDeletedPost(existing) ||
      (input.parentId && !findCommentInTree(existing.comments, input.parentId))
    ) {
      return jsonError("Post not found, deleted, or cannot accept this reply.", 404);
    }
    const actorHandle = String(body.authorHandle ?? "");
    if (!(await localCommunityParticipationAllowed(existing, actorHandle))) return jsonError("Join this community before participating.", 403);
    if (attachmentIds.length && (existing.room === "office" || existing.kind === "draft")) {
      return jsonError("Private comment attachments require protected delivery before they can be published.", 412);
    }
    const attachments = await replaceLocalOwnerAttachments({
      actorHandle,
      attachmentIds,
      ownerId: commentId,
      ownerType: "comment"
    });
    await assertLocalQuoteDestination(snapshot.items, actorHandle, quoteSource?.data, {
      ownerType: "comment",
      communityId: existing.communityId,
      postType: existing.postType
    });
    const quote = resolveLocalContentQuote(await localQuoteSourceItems(snapshot.items, actorHandle), quoteSource?.data, {
      ownerId: commentId,
      ownerType: "comment"
    });
    const result = await addComment(id, { ...input, id: commentId, attachments, quote }, actorHandle);
    if (!result) {
      await deleteLocalOwnerAttachments("comment", commentId);
      return jsonError("Post not found, deleted, or cannot accept this reply.", 404);
    }

    return Response.json(result);
  } catch (error) {
    if (error instanceof ContentQuoteError) return jsonError(error.message, error.status);
    if (error instanceof LocalAttachmentStoreError) return jsonError(error.message, error.status);
    throw error;
  }
}
