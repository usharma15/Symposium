import { createPost, getSnapshot, type CreatePostInput } from "@/lib/dataStore";
import type { ContentKind, RoomId } from "@/lib/mockData";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { cleanHandle, contentKinds, isSavedBy, postRooms } from "@/lib/symposiumCore";
import { ContentQuoteError, resolveLocalContentQuote } from "@/lib/contentQuotes";
import { contentQuoteSourceSchema, opportunityPostInputSchema, patronageProposalInputSchema, postPageQuerySchema, postTypeSchema, versionedDocumentSchema } from "@/packages/contracts/src";
import { postTypeForItem } from "@/lib/postSemantics";
import {
  LocalAttachmentStoreError,
  replaceLocalOwnerAttachments,
  resolveLocalPostAttachments
} from "@/lib/localAttachmentStore";
import { listLocalCommunities } from "@/lib/localCommunityStore";
import { projectCommunityItemsForViewer } from "@/lib/communityContentProjection";
import { assertLocalQuoteDestination, localQuoteSourceItems } from "@/lib/localCommunityAuthorization";
import { publicResearchProfile } from "@/lib/publicProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const localCommentCount = (comments: Awaited<ReturnType<typeof getSnapshot>>["items"][number]["comments"]): number =>
  comments.reduce((total, comment) => total + (comment.deletedAt ? 0 : 1) + localCommentCount(comment.replies ?? []), 0);

const selectLocalComments = (
  comments: Awaited<ReturnType<typeof getSnapshot>>["items"][number]["comments"],
  selectedIds: ReadonlySet<string>
): Awaited<ReturnType<typeof getSnapshot>>["items"][number]["comments"] => {
  const selected: Awaited<ReturnType<typeof getSnapshot>>["items"][number]["comments"] = [];
  for (const comment of comments) {
    if (comment.id && selectedIds.has(comment.id) && !comment.deletedAt) {
      selected.push({ ...comment, replies: [] });
    }
    selected.push(...selectLocalComments(comment.replies ?? [], selectedIds));
  }
  return selected;
};

export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const actorHandle = parameters.get("actorHandle") ?? undefined;
  parameters.delete("actorHandle");
  const query = parameters.toString();
  const live = await proxyLiveBackend(`/v1/posts${query ? `?${query}` : ""}`, { actorHandle });
  if (live) return live;

  const snapshot = await getSnapshot();
  const communities = await listLocalCommunities(actorHandle);
  const viewerHandle = actorHandle ? cleanHandle(actorHandle) : null;
  const parsed = postPageQuerySchema.safeParse({
    cursor: parameters.get("cursor") ?? undefined,
    limit: parameters.get("limit") ? Number(parameters.get("limit")) : undefined,
    room: parameters.get("room") ?? undefined,
    postType: parameters.get("postType") ?? undefined,
    postTypes: parameters.get("postTypes")?.split(",").filter(Boolean),
    communityId: parameters.get("communityId") ?? undefined,
    authorHandle: parameters.get("authorHandle") ?? undefined,
    saved: parameters.get("saved") === "true" ? true : undefined,
    following: parameters.get("following") === "true" ? true : undefined,
    ids: parameters.get("ids")?.split(",").filter(Boolean),
    commentIds: parameters.get("commentIds")?.split(",").filter(Boolean)
  });
  if (!parsed.success) return jsonError("Invalid post page query.", 400);
  const input = parsed.data;
  const cursor = input.cursor
    ? (() => {
        try {
          return JSON.parse(Buffer.from(input.cursor!, "base64url").toString("utf8")) as { createdAt?: string; id?: string };
        } catch {
          return null;
        }
      })()
    : null;
  if (input.cursor && (!cursor?.createdAt || !cursor.id || Number.isNaN(Date.parse(cursor.createdAt)))) {
    return jsonError("Invalid post cursor.", 400);
  }
  const visible = projectCommunityItemsForViewer(snapshot.items, communities, actorHandle)
    .filter((item) => !item.deletedAt)
    .filter((item) => (item.room !== "office" && item.kind !== "draft")
      || Boolean(viewerHandle && cleanHandle(item.authorHandle ?? "") === viewerHandle))
    .filter((item) => input.communityId || input.ids?.length || input.commentIds?.length || !item.communityId || item.postType === "paper")
    .filter((item) => !input.room || item.room === input.room)
    .filter((item) => !input.postType || postTypeForItem(item) === input.postType)
    .filter((item) => !input.postTypes?.length || input.postTypes.includes(postTypeForItem(item)!))
    .filter((item) => !input.communityId || item.communityId === input.communityId)
    .filter((item) => !input.authorHandle || cleanHandle(item.authorHandle ?? "") === cleanHandle(input.authorHandle))
    .filter((item) => !input.saved || isSavedBy(item, actorHandle ?? "", ""))
    .filter((item) => !input.following || Boolean(viewerHandle && cleanHandle(item.authorHandle ?? "") === viewerHandle))
    .filter((item) => !input.ids?.length || input.ids.includes(item.id))
    .filter((item) => !cursor || (item.createdAt ?? "") < cursor.createdAt! || ((item.createdAt ?? "") === cursor.createdAt && item.id < cursor.id!))
    .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "") || right.id.localeCompare(left.id));
  const limit = input.ids?.length ? Math.min(input.ids.length, 50) : input.limit;
  const page = visible.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const selectedCommentIds = new Set(input.commentIds ?? []);
  const items = page.slice(0, limit).map((item) => ({
    ...item,
    commentCount: localCommentCount(item.comments),
    detailLoaded: false,
    comments: selectedCommentIds.size ? selectLocalComments(item.comments, selectedCommentIds) : [],
    saved: Boolean(viewerHandle && item.savedBy?.some((handle) => cleanHandle(handle) === viewerHandle)),
    savedBy: viewerHandle && item.savedBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
    signaledBy: viewerHandle && item.signaledBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
    forkedBy: viewerHandle && item.forkedBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : []
  }));
  const profiles = Object.fromEntries(items.flatMap((item) => {
    const handle = cleanHandle(item.authorHandle ?? "");
    return snapshot.profiles[handle] ? [[handle, publicResearchProfile(snapshot.profiles[handle])]] : [];
  }));
  const last = items.at(-1);
  return Response.json({
    items,
    profiles,
    nextCursor: hasMore && last
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString("base64url")
      : null
  });
}

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const body = await readJson<Partial<CreatePostInput> & {
    attachmentIds?: unknown[];
    authorHandle?: string;
    communityId?: string;
    quoteSource?: unknown;
    patronage?: unknown;
    opportunity?: unknown;
  }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const kind = String(body.kind ?? "");
  const room = String(body.room ?? "");
  const postType = postTypeSchema.safeParse(body.postType);
  if (!postType.success) return jsonError("Choose a valid publication type.", 400);
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map((attachmentId) => String(attachmentId))
    : Array.isArray(body.attachments)
      ? body.attachments.map((attachment) => String(attachment.id))
      : [];
  const input: CreatePostInput = {
    title: String(body.title ?? "").trim(),
    body: String(body.body ?? "").trim(),
    document: body.document === undefined ? undefined : versionedDocumentSchema.safeParse(body.document).data,
    kind: contentKinds.includes(kind as ContentKind) ? (kind as ContentKind) : "thought",
    postType: postType.data,
    room: postRooms.includes(room as Exclude<RoomId, "hall">)
      ? (room as Exclude<RoomId, "hall">)
      : "symposium",
    communityId: body.communityId ? String(body.communityId) : undefined,
    attachments: Array.isArray(body.attachments) ? body.attachments : []
  };

  if (!input.title || !input.body) {
    return jsonError("Title and body are required.", 400);
  }
  if (input.kind !== "paper" && input.kind !== "thought" && input.kind !== "note") {
    return jsonError("Private drafts and code artifacts publish through the Workspace, not the public post endpoint.", 400);
  }
  if (body.document !== undefined && !versionedDocumentSchema.safeParse(body.document).success) {
    return jsonError("The post document is invalid or unsupported.", 400);
  }
  const quoteSource = body.quoteSource === undefined ? undefined : contentQuoteSourceSchema.safeParse(body.quoteSource);
  if (quoteSource && !quoteSource.success) return jsonError("Choose an available post or comment to quote.", 400);
  const patronage = body.patronage === undefined ? undefined : patronageProposalInputSchema.safeParse(body.patronage);
  if (patronage && !patronage.success) return jsonError("Add a valid funding goal and proposal status.", 400);
  const opportunity = body.opportunity === undefined ? undefined : opportunityPostInputSchema.safeParse(body.opportunity);
  if (opportunity && !opportunity.success) return jsonError("Add valid opportunity details.", 400);
  if ((input.room === "funding") !== Boolean(patronage?.success) || (patronage?.success && input.kind !== "paper")) {
    return jsonError("Patronage proposals publish as paper-grade posts in the Patronage Hall.", 400);
  }
  if ((input.room === "opportunities") !== Boolean(opportunity?.success) || (opportunity?.success && input.kind !== "thought")) {
    return jsonError("Opportunities publish as thought-grade posts with application metadata.", 400);
  }
  const expectedPostType = patronage?.success
    ? "proposal"
    : opportunity?.success
      ? "opportunity"
      : input.kind === "paper"
        ? "paper"
        : "thought";
  if (input.postType !== expectedPostType) {
    return jsonError("The publication type must describe the post independently of its editor format.", 400);
  }
  if (input.communityId && input.postType === "paper" && input.room !== "library") {
    return jsonError("Community papers publish canonically in the Library.", 400);
  }

  const live = await proxyLiveBackend("/v1/posts", {
    method: "POST",
    body: {
      title: input.title,
      body: input.body,
      document: input.document,
      kind: input.kind,
      postType: input.postType,
      room: input.room,
      communityId: input.communityId,
      authorHandle: body.authorHandle,
      attachmentIds,
      quoteSource: quoteSource?.data,
      patronage: patronage?.data,
      opportunity: opportunity?.data
    },
    actorHandle: body.authorHandle ? String(body.authorHandle) : undefined,
    idempotencyKey
  });
  if (live) return live;

  try {
    if (input.communityId) {
      const community = (await listLocalCommunities(String(body.authorHandle ?? ""))).find((candidate) => candidate.id === input.communityId);
      if (!community || community.membershipStatus !== "active") return jsonError("Join this community before participating.", 403);
    }
    if (attachmentIds.length && input.room === "office") {
      return jsonError("Private post attachments require protected delivery before they can be published.", 412);
    }
    const snapshot = await getSnapshot();
    const localAttachments = attachmentIds.length
      ? await resolveLocalPostAttachments(attachmentIds, String(body.authorHandle ?? ""))
      : [];
    await assertLocalQuoteDestination(snapshot.items, String(body.authorHandle ?? ""), quoteSource?.data, {
      ownerType: "post",
      communityId: input.communityId,
      postType: input.postType
    });
    const quote = resolveLocalContentQuote(
      await localQuoteSourceItems(snapshot.items, String(body.authorHandle ?? "")),
      quoteSource?.data
    );
    const item = await createPost({ ...input, attachments: localAttachments, quote, patronage: patronage?.data, opportunity: opportunity?.data }, String(body.authorHandle ?? ""));
    await replaceLocalOwnerAttachments({
      actorHandle: String(body.authorHandle ?? ""),
      attachmentIds,
      ownerId: item.id,
      ownerType: "post"
    });
    return Response.json({ item });
  } catch (error) {
    if (error instanceof ContentQuoteError) return jsonError(error.message, error.status);
    if (error instanceof LocalAttachmentStoreError) return jsonError(error.message, error.status);
    throw error;
  }
}
