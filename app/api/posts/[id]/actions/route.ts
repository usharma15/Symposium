import { applyPostAction, type PostAction } from "@/lib/dataStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

const actions: PostAction[] = ["signal", "save", "fork", "read"];

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = (await request.json()) as { action?: string; actorHandle?: string };
  const action = String(body.action ?? "");

  if (!actions.includes(action as PostAction)) {
    return Response.json({ error: "Unknown post action." }, { status: 400 });
  }

  const item = await applyPostAction(id, action as PostAction, String(body.actorHandle ?? ""));

  if (!item) {
    return Response.json({ error: "Post not found." }, { status: 404 });
  }

  return Response.json({ item });
}
