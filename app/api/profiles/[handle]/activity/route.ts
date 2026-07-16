import { getSnapshot } from "@/lib/dataStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { cleanHandle } from "@/lib/symposiumCore";
import type { ToggleActionContract } from "@/packages/contracts/src";
import { hiddenCommunityActivityCounts, profileCommentsArePubliclyListable, profileItemIsPubliclyListable } from "@/lib/profileActivity";
import { listLocalCommunities } from "@/lib/localCommunityStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ handle: string }>;
};

export async function GET(request: Request, context: Context) {
  const { handle } = await context.params;
  const targetHandle = cleanHandle(decodeURIComponent(handle));
  const url = new URL(request.url);
  const actorHandle = cleanHandle(url.searchParams.get("actorHandle") ?? "");
  const liveQuery = new URLSearchParams(url.searchParams);
  liveQuery.delete("actorHandle");
  const query = liveQuery.toString();
  const live = await proxyLiveBackend(
    `/v1/profiles/${encodeURIComponent(targetHandle)}/activity${query ? `?${query}` : ""}`,
    { actorHandle: actorHandle === "@" ? undefined : actorHandle }
  );
  if (live) return live;

  const snapshot = await getSnapshot();
  const person = snapshot.profiles[targetHandle];
  if (!person) return Response.json({ error: "Profile not found." }, { status: 404 });
  const ownProfile = actorHandle === targetHandle;
  const allowedActions: ToggleActionContract[] = [
    ...(ownProfile ? (["save"] as const) : []),
    ...(ownProfile || person.likesPublic !== false ? (["signal"] as const) : []),
    ...(ownProfile || person.resharesPublic !== false ? (["fork"] as const) : [])
  ];
  const rawLimit = Number(url.searchParams.get("limit") ?? 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500) : 200;
  const rawCursor = url.searchParams.get("cursor");
  let offset = 0;
  if (rawCursor) {
    try {
      const parsed = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8")) as { offset?: unknown };
      if (typeof parsed.offset !== "number" || !Number.isInteger(parsed.offset) || parsed.offset < 0) {
        return Response.json({ error: "Invalid activity cursor." }, { status: 400 });
      }
      offset = parsed.offset;
    } catch {
      return Response.json({ error: "Invalid activity cursor." }, { status: 400 });
    }
  }
  const allowed = new Set(allowedActions);
  const communities = await listLocalCommunities();
  const itemById = new Map(snapshot.items.map((item) => [item.id, item]));
  const entries = Object.values(snapshot.actionLedger)
    .filter(
      (activity) =>
        cleanHandle(activity.actorHandle) === targetHandle &&
        allowed.has(activity.action) &&
        (ownProfile || activity.active) &&
        Boolean(itemById.get(activity.postId) && (
          activity.subjectType === "comment"
            ? profileCommentsArePubliclyListable(itemById.get(activity.postId)!, communities)
            : profileItemIsPubliclyListable(itemById.get(activity.postId)!, communities)
        ))
    )
    .sort((a, b) => {
      const timestampDelta = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
      if (timestampDelta) return timestampDelta;
      return `${b.subjectType}:${b.subjectId}:${b.action}`.localeCompare(
        `${a.subjectType}:${a.subjectId}:${a.action}`
      );
    });
  const page = entries.slice(offset, offset + limit);
  const nextOffset = offset + page.length;

  return Response.json({
    entries: page,
    nextCursor:
      nextOffset < entries.length
        ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString("base64url")
        : null,
    hiddenCommunityCounts: hiddenCommunityActivityCounts(snapshot.items, communities, targetHandle, allowedActions)
  });
}
