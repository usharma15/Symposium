import { deletePost, updatePost, type UpdatePostInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<Partial<UpdatePostInput> & { actorHandle?: string }>(request);

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
  const live = await proxyLiveBackend(`/v1/posts/${id}`, {
    method: "PATCH",
    body: { ...input, actorHandle },
    actorHandle
  });
  if (live) return live;

  const item = await updatePost(id, input, actorHandle ?? "");
  if (!item) {
    return jsonError("Post not found or cannot be edited by this profile.", 404);
  }

  return Response.json({ item });
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await readJson<{ actorHandle?: string }>(request);
  const actorHandle = body?.actorHandle ? String(body.actorHandle) : undefined;

  const live = await proxyLiveBackend(`/v1/posts/${id}`, {
    method: "DELETE",
    body: { actorHandle },
    actorHandle
  });
  if (live) return live;

  const deleted = await deletePost(id, actorHandle ?? "");
  if (!deleted) {
    return jsonError("Post not found or cannot be deleted by this profile.", 404);
  }

  return Response.json({ deleted });
}
