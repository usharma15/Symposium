import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { cleanHandle } from "@/lib/symposiumCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ handle: string }>;
};

type FollowBody = {
  actorHandle?: string;
  status?: string;
};

const targetFromContext = async (context: Context) => {
  const { handle } = await context.params;
  return cleanHandle(decodeURIComponent(handle));
};

export async function POST(request: Request, context: Context) {
  const targetHandle = await targetFromContext(context);
  const body = (await readJson<FollowBody>(request)) ?? {};

  if (!targetHandle) {
    return jsonError("Profile handle is required.", 400);
  }

  const live = await proxyLiveBackend(`/v1/profiles/${encodeURIComponent(targetHandle)}/follow`, {
    method: "POST",
    body: { targetHandle, status: body.status ?? "active" },
    actorHandle: body.actorHandle ? String(body.actorHandle) : undefined
  });
  if (live) return live;

  const followerHandle = cleanHandle(String(body.actorHandle ?? "@usharma"));

  if (followerHandle === targetHandle) {
    return jsonError("You cannot follow yourself.", 400);
  }

  return Response.json({
    follow: { followerHandle, followingHandle: targetHandle, status: body.status ?? "active" }
  });
}

export async function DELETE(request: Request, context: Context) {
  const targetHandle = await targetFromContext(context);
  const body = (await readJson<FollowBody>(request)) ?? {};

  if (!targetHandle) {
    return jsonError("Profile handle is required.", 400);
  }

  const live = await proxyLiveBackend(`/v1/profiles/${encodeURIComponent(targetHandle)}/follow`, {
    method: "DELETE",
    actorHandle: body.actorHandle ? String(body.actorHandle) : undefined
  });
  if (live) return live;

  return Response.json({
    follow: {
      followerHandle: cleanHandle(String(body.actorHandle ?? "@usharma")),
      followingHandle: targetHandle,
      status: "none"
    }
  });
}
