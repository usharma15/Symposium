import { addComment, type CreateCommentInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const body = await readJson<Partial<CreateCommentInput> & { authorHandle?: string }>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const input: CreateCommentInput = {
    body: String(body.body ?? "").trim(),
    stance: String(body.stance ?? "Comment").trim(),
    parentId: body.parentId ? String(body.parentId) : null
  };

  if (!input.body) {
    return jsonError("Comment body is required.", 400);
  }

  const live = await proxyLiveBackend(`/v1/posts/${id}/comments`, {
    method: "POST",
    body: { ...input, authorHandle: body.authorHandle },
    actorHandle: body.authorHandle ? String(body.authorHandle) : undefined,
    idempotencyKey
  });
  if (live) return live;

  const result = await addComment(id, input, String(body.authorHandle ?? ""));
  if (!result) {
    return jsonError("Post not found, deleted, or cannot accept this reply.", 404);
  }

  return Response.json(result);
}
