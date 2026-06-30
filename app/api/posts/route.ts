import { createPost, getSnapshot, type CreatePostInput } from "@/lib/dataStore";
import type { ContentKind, RoomId } from "@/lib/mockData";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { contentKinds, postRooms } from "@/lib/symposiumCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const live = await proxyLiveBackend("/v1/posts");
  if (live) return live;

  const snapshot = await getSnapshot();
  return Response.json({ items: snapshot.items });
}

export async function POST(request: Request) {
  const body = await readJson<Partial<CreatePostInput> & { authorHandle?: string }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const kind = String(body.kind ?? "");
  const room = String(body.room ?? "");
  const input: CreatePostInput = {
    title: String(body.title ?? "").trim(),
    body: String(body.body ?? "").trim(),
    kind: contentKinds.includes(kind as ContentKind) ? (kind as ContentKind) : "thought",
    room: postRooms.includes(room as Exclude<RoomId, "hall">)
      ? (room as Exclude<RoomId, "hall">)
      : "symposium"
  };

  if (!input.title || !input.body) {
    return jsonError("Title and body are required.", 400);
  }

  const live = await proxyLiveBackend("/v1/posts", {
    method: "POST",
    body: { ...input, authorHandle: body.authorHandle },
    actorHandle: body.authorHandle ? String(body.authorHandle) : undefined
  });
  if (live) return live;

  const item = await createPost(input, String(body.authorHandle ?? ""));
  return Response.json({ item });
}
