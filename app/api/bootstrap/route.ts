import { getSnapshot } from "@/lib/dataStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { profile } from "@/lib/mockData";
import { listAllLocalCommunityCalls, listLocalCommunities } from "@/lib/localCommunityStore";
import { projectCommunityItemsForViewer } from "@/lib/communityContentProjection";
import { cleanHandle } from "@/lib/symposiumCore";
import { publicResearchProfile } from "@/lib/publicProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const commentCount = (comments: Awaited<ReturnType<typeof getSnapshot>>["items"][number]["comments"]): number =>
  comments.reduce((total, comment) => total + (comment.deletedAt ? 0 : 1) + commentCount(comment.replies ?? []), 0);

export async function GET(request: Request) {
  const actorHandle = new URL(request.url).searchParams.get("actorHandle") ?? undefined;
  const live = await proxyLiveBackend("/v1/bootstrap", { actorHandle });
  if (live) return live;

  const snapshot = await getSnapshot();
  const [communities, communityCalls] = await Promise.all([
    listLocalCommunities(actorHandle),
    listAllLocalCommunityCalls(actorHandle)
  ]);
  const viewerHandle = actorHandle ? cleanHandle(actorHandle) : null;
  const projectedItems = projectCommunityItemsForViewer(snapshot.items, communities, actorHandle)
    .filter((item) => !item.deletedAt && item.room !== "office" && item.kind !== "draft")
    .filter((item) => !item.communityId || item.postType === "paper")
    .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "") || right.id.localeCompare(left.id));
  const items = projectedItems.slice(0, 24).map((item) => ({
    ...item,
    commentCount: commentCount(item.comments),
    detailLoaded: false,
    comments: [],
    saved: Boolean(viewerHandle && item.savedBy?.some((handle) => cleanHandle(handle) === viewerHandle)),
    savedBy: viewerHandle && item.savedBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
    signaledBy: viewerHandle && item.signaledBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
    forkedBy: viewerHandle && item.forkedBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : []
  }));
  const profileHandles = new Set([
    profile.handle,
    ...(viewerHandle ? [viewerHandle] : []),
    ...items.flatMap((item) => item.authorHandle ? [cleanHandle(item.authorHandle)] : [])
  ]);
  const profiles = Object.fromEntries([...profileHandles].flatMap((handle) =>
    snapshot.profiles[handle] ? [[handle, publicResearchProfile(snapshot.profiles[handle])]] : []
  ));
  const last = items.at(-1);
  return Response.json({
    profiles,
    items,
    communities,
    communityCalls: Object.fromEntries(Object.entries(communityCalls).map(([communityId, calls]) => [communityId, calls.slice(0, 5)])),
    defaultProfile: publicResearchProfile(profile),
    nextCursor: projectedItems.length > 24 && last
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString("base64url")
      : null,
    readModelVersion: 2
  });
}
