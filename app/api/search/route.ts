import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { getSnapshot } from "@/lib/dataStore";
import { listLocalCommunities } from "@/lib/localCommunityStore";
import { projectCommunityItemsForViewer } from "@/lib/communityContentProjection";
import { communityPostIsExternallyDiscoverable } from "@/features/communities/communityPolicy";
import { communitySearchText, searchableText } from "@/features/discovery/discoveryPolicy";
import { cleanHandle, normalizeSearchPhrase } from "@/lib/symposiumCore";
import { publicResearchProfile } from "@/lib/publicProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const localCommentCount = (comments: Awaited<ReturnType<typeof getSnapshot>>["items"][number]["comments"]): number =>
  comments.reduce((total, comment) => total + (comment.deletedAt ? 0 : 1) + localCommentCount(comment.replies ?? []), 0);

export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const actorHandle = parameters.get("actorHandle") ?? undefined;
  parameters.delete("actorHandle");
  const query = parameters.toString();
  const live = await proxyLiveBackend(`/v1/search${query ? `?${query}` : ""}`, { actorHandle });
  if (live) return live;
  const term = normalizeSearchPhrase(parameters.get("q") ?? "");
  if (!term) return Response.json({ posts: [], profiles: [], communities: [], nextCursor: null });
  const limit = Math.max(1, Math.min(Number(parameters.get("limit")) || 12, 50));
  const viewerHandle = actorHandle ? cleanHandle(actorHandle) : null;
  const snapshot = await getSnapshot();
  const communities = await listLocalCommunities(actorHandle);
  const posts = projectCommunityItemsForViewer(snapshot.items, communities, actorHandle)
    .filter((item) => !item.deletedAt && item.room !== "office" && item.kind !== "draft")
    .filter(communityPostIsExternallyDiscoverable)
    .filter((item) => searchableText(item).includes(term))
    .slice(0, limit)
    .map((item) => ({
      ...item,
      commentCount: localCommentCount(item.comments),
      detailLoaded: false,
      comments: [],
      saved: Boolean(viewerHandle && item.savedBy?.some((handle) => cleanHandle(handle) === viewerHandle)),
      savedBy: viewerHandle && item.savedBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
      signaledBy: viewerHandle && item.signaledBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : [],
      forkedBy: viewerHandle && item.forkedBy?.some((handle) => cleanHandle(handle) === viewerHandle) ? [viewerHandle] : []
    }));
  const profiles = Object.values(snapshot.profiles)
    .filter((person) => normalizeSearchPhrase([
      person.name,
      person.handle,
      person.role,
      person.location,
      person.bio,
      ...person.fields
    ].join(" ")).includes(term))
    .slice(0, limit)
    .map(publicResearchProfile);
  return Response.json({
    posts,
    profiles,
    communities: communities.filter((community) => communitySearchText(community).includes(term)).slice(0, limit),
    nextCursor: null
  });
}
