import { deletePost, getSnapshot, updatePost, type UpdatePostInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { deleteLocalOpportunityApplicationsForPost } from "@/lib/localOpportunityApplicationStore";
import {
  deleteLocalOwnerAttachments,
  LocalAttachmentStoreError,
  replaceLocalOwnerAttachments
} from "@/lib/localAttachmentStore";
import { cleanHandle, isDeletedPost } from "@/lib/symposiumCore";
import { ContentQuoteError, resolveLocalContentQuote } from "@/lib/contentQuotes";
import { contentQuoteSourceSchema, opportunityPostInputSchema, patronageProposalInputSchema, versionedDocumentSchema } from "@/packages/contracts/src";
import { assertLocalQuoteDestination, localCommunityManagerAllowed, localCommunityReadAllowed, localQuoteSourceItems } from "@/lib/localCommunityAuthorization";
import { publicResearchProfile } from "@/lib/publicProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  const actorHandle = new URL(request.url).searchParams.get("actorHandle") ?? undefined;
  const viewerHandle = actorHandle ? cleanHandle(actorHandle) : null;
  const live = await proxyLiveBackend(`/v1/posts/${encodeURIComponent(id)}`, { actorHandle });
  if (live) return live;

  const snapshot = await getSnapshot();
  const item = snapshot.items.find((candidate) => candidate.id === id);
  const ownsPrivateItem = Boolean(item && viewerHandle && cleanHandle(item.authorHandle ?? "") === viewerHandle);
  if (
    !item
    || isDeletedPost(item)
    || ((item.room === "office" || item.kind === "draft") && !ownsPrivateItem)
    || !(await localCommunityReadAllowed(item, actorHandle ?? ""))
  ) {
    return jsonError("Post not found.", 404);
  }
  const projectComment = (comment: typeof item.comments[number]): typeof item.comments[number] => ({
    ...comment,
    savedBy: viewerHandle && comment.savedBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
    signaledBy: viewerHandle && comment.signaledBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
    forkedBy: viewerHandle && comment.forkedBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
    replies: (comment.replies ?? []).map(projectComment)
  });
  const profiles = Object.fromEntries(
    [item.authorHandle, ...item.comments.flatMap(function handles(comment): string[] {
      return [...(comment.authorHandle ? [comment.authorHandle] : []), ...(comment.replies ?? []).flatMap(handles)];
    })]
      .filter((handle): handle is string => Boolean(handle))
      .flatMap((handle) => {
        const person = snapshot.profiles[handle];
        return person ? [[handle, publicResearchProfile(person)] as const] : [];
      })
  );
  return Response.json({
    item: {
      ...item,
      saved: Boolean(viewerHandle && item.savedBy?.some((handle) => cleanHandle(handle) === viewerHandle)),
      savedBy: viewerHandle && item.savedBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
      signaledBy: viewerHandle && item.signaledBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
      forkedBy: viewerHandle && item.forkedBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
      comments: item.comments.map(projectComment),
      commentCount: item.comments.flatMap(function flatten(comment): typeof item.comments {
        return [...(comment.deletedAt ? [] : [comment]), ...(comment.replies ?? []).flatMap(flatten)];
      }).length,
      detailLoaded: true
    },
    profiles
  });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<Partial<UpdatePostInput> & {
    actorHandle?: string;
    attachmentIds?: unknown[];
    expectedEditedAt?: string | null;
    quoteSource?: unknown;
    patronage?: unknown;
    opportunity?: unknown;
  }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const input: UpdatePostInput = {
    title: String(body.title ?? "").trim(),
    body: String(body.body ?? "").trim(),
    document: body.document === undefined ? undefined : versionedDocumentSchema.safeParse(body.document).data
  };

  if (!input.title || !input.body) {
    return jsonError("Title and body are required.", 400);
  }
  if (body.document !== undefined && !versionedDocumentSchema.safeParse(body.document).success) {
    return jsonError("The post document is invalid or unsupported.", 400);
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
  const patronage = body.patronage === undefined ? undefined : patronageProposalInputSchema.safeParse(body.patronage);
  if (patronage && !patronage.success) return jsonError("Add a valid funding goal and proposal status.", 400);
  const opportunity = body.opportunity === undefined ? undefined : opportunityPostInputSchema.safeParse(body.opportunity);
  if (opportunity && !opportunity.success) return jsonError("Add valid opportunity details.", 400);
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const live = await proxyLiveBackend(`/v1/posts/${id}`, {
    method: "PATCH",
    body: { ...input, actorHandle, attachmentIds, quoteSource: parsedQuoteSource, patronage: patronage?.data, opportunity: opportunity?.data, expectedEditedAt: body.expectedEditedAt },
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
    if (!(await localCommunityReadAllowed(existing, actorHandle ?? ""))) return jsonError("Post not found.", 404);
    if (attachmentIds?.length && (existing.room === "office" || existing.kind === "draft")) {
      return jsonError("Private post attachments require protected delivery before they can be published.", 412);
    }
    if ((attachmentIds || body.quoteSource !== undefined || body.document !== undefined || body.patronage !== undefined || body.opportunity !== undefined) && body.expectedEditedAt === undefined) {
      return jsonError("The current post edit version is required when changing structured post content.", 400);
    }
    if (body.expectedEditedAt !== undefined && (existing.editedAt ?? null) !== body.expectedEditedAt) {
      return jsonError("This post changed after editing began. Refresh it before saving again.", 409);
    }
    const attachments = attachmentIds
      ? await replaceLocalOwnerAttachments({ actorHandle, attachmentIds, ownerId: id, ownerType: "post" })
      : undefined;
    await assertLocalQuoteDestination(snapshot.items, actorHandle ?? "", parsedQuoteSource ?? undefined, {
      ownerType: "post",
      communityId: existing.communityId,
      postType: existing.postType
    });
    const quote = body.quoteSource === undefined
      ? undefined
      : parsedQuoteSource === null
        ? null
        : resolveLocalContentQuote(await localQuoteSourceItems(snapshot.items, actorHandle ?? ""), parsedQuoteSource, { ownerId: id, ownerType: "post" });
    if (patronage?.success && !existing.patronage) return jsonError("Only Patronage proposals can receive funding details.", 400);
    if (opportunity?.success && !existing.opportunity) return jsonError("Only Opportunity posts can receive opportunity metadata.", 400);
    const item = await updatePost(id, { ...input, attachments, quote, patronage: patronage?.data, opportunity: opportunity?.data }, actorHandle ?? "");
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

  const existing = (await getSnapshot()).items.find((item) => item.id === id);
  if (existing && !(await localCommunityReadAllowed(existing, actorHandle ?? ""))) return jsonError("Post not found.", 404);
  if (existing?.opportunity) await deleteLocalOpportunityApplicationsForPost(id, actorHandle ?? "");
  const item = await deletePost(id, actorHandle ?? "", existing ? await localCommunityManagerAllowed(existing, actorHandle ?? "") : false);
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
