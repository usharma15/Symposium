import { createPost, getSnapshot, type CreatePostInput } from "@/lib/dataStore";
import type { ContentKind, RoomId } from "@/lib/mockData";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { contentKinds, postRooms } from "@/lib/symposiumCore";
import { ContentQuoteError, resolveLocalContentQuote } from "@/lib/contentQuotes";
import { contentQuoteSourceSchema } from "@/packages/contracts/src";
import {
  LocalAttachmentStoreError,
  replaceLocalOwnerAttachments,
  resolveLocalPostAttachments
} from "@/lib/localAttachmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const live = await proxyLiveBackend("/v1/posts");
  if (live) return live;

  const snapshot = await getSnapshot();
  return Response.json({ items: snapshot.items });
}

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const body = await readJson<Partial<CreatePostInput> & {
    attachmentIds?: unknown[];
    authorHandle?: string;
    quoteSource?: unknown;
  }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const kind = String(body.kind ?? "");
  const room = String(body.room ?? "");
  const attachmentIds = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map((attachmentId) => String(attachmentId))
    : Array.isArray(body.attachments)
      ? body.attachments.map((attachment) => String(attachment.id))
      : [];
  const input: CreatePostInput = {
    title: String(body.title ?? "").trim(),
    body: String(body.body ?? "").trim(),
    kind: contentKinds.includes(kind as ContentKind) ? (kind as ContentKind) : "thought",
    room: postRooms.includes(room as Exclude<RoomId, "hall">)
      ? (room as Exclude<RoomId, "hall">)
      : "symposium",
    attachments: Array.isArray(body.attachments) ? body.attachments : []
  };

  if (!input.title || !input.body) {
    return jsonError("Title and body are required.", 400);
  }
  const quoteSource = body.quoteSource === undefined ? undefined : contentQuoteSourceSchema.safeParse(body.quoteSource);
  if (quoteSource && !quoteSource.success) return jsonError("Choose an available post or comment to quote.", 400);

  const live = await proxyLiveBackend("/v1/posts", {
    method: "POST",
    body: {
      title: input.title,
      body: input.body,
      kind: input.kind,
      room: input.room,
      authorHandle: body.authorHandle,
      attachmentIds,
      quoteSource: quoteSource?.data
    },
    actorHandle: body.authorHandle ? String(body.authorHandle) : undefined,
    idempotencyKey
  });
  if (live) return live;

  try {
    if (attachmentIds.length && (input.room === "office" || input.kind === "draft")) {
      return jsonError("Private post attachments require protected delivery before they can be published.", 412);
    }
    const snapshot = await getSnapshot();
    const localAttachments = attachmentIds.length
      ? await resolveLocalPostAttachments(attachmentIds, String(body.authorHandle ?? ""))
      : [];
    const quote = resolveLocalContentQuote(snapshot.items, quoteSource?.data);
    const item = await createPost({ ...input, attachments: localAttachments, quote }, String(body.authorHandle ?? ""));
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
