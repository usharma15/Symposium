import { addComment, type CreateCommentInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
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

  const comment = await addComment(id, input, String(body.authorHandle ?? ""));
  return Response.json({ comment });
}
