import type { RoomId } from "@/lib/mockData";
import type { CanonicalRoute, ProfileSocialView, ProfileTab } from "@/features/navigation/canonicalRoute";

export type OfficeMode = "desk" | "saved" | "notes";

export type ViewSnapshot = {
  activeRoom: RoomId;
  selectedItemId: string | null;
  applicationReviewPostId: string | null;
  selectedApplicationId: string | null;
  selectedCommentId: string | null;
  selectedProfileName: string | null;
  profileSocialView: ProfileSocialView | null;
  profileTab: ProfileTab;
  officeMode: OfficeMode;
  selectedCommunityId: string | null;
  messagesOpen: boolean;
  selectedConversationId: string | null;
  commentSegmentStacks: Record<string, string[]>;
  scrollAnchor: { id: string; top: number; commentSegmentKey?: string; commentSegmentStack?: string[] } | null;
  scrollY: number;
};

export const roomForCanonicalRoute = (
  route: CanonicalRoute,
  resolvePostRoom: (postId: string) => RoomId | undefined = () => undefined
): RoomId => {
  if (route.kind === "room") return route.roomId;
  if (route.kind === "post") return resolvePostRoom(route.postId) ?? "hall";
  if (route.kind === "opportunityApplications") return "opportunities";
  if (route.kind === "workspace") return "office";
  if (route.kind === "funding") return "funding";
  if (route.kind === "opportunities") return "opportunities";
  if (route.kind === "community" || route.kind === "communities") return "communities";
  return "hall";
};

export const officeModeForCanonicalRoute = (route: CanonicalRoute): OfficeMode =>
  route.kind === "workspace" ? route.view ?? "desk" : "desk";

export const canonicalRouteForView = (
  snapshot: ViewSnapshot,
  resolveProfileHandle: (nameOrHandle: string) => string = (value) => value
): CanonicalRoute => {
  if (snapshot.messagesOpen) {
    return {
      kind: "messages",
      conversationId: snapshot.selectedConversationId ?? undefined
    };
  }
  if (snapshot.applicationReviewPostId) {
    return { kind: "opportunityApplications", postId: snapshot.applicationReviewPostId, applicationId: snapshot.selectedApplicationId ?? undefined };
  }
  if (snapshot.selectedItemId) {
    return {
      kind: "post",
      postId: snapshot.selectedItemId,
      commentId: snapshot.selectedCommentId ?? undefined
    };
  }
  if (snapshot.selectedProfileName) {
    return {
      kind: "profile",
      handle: resolveProfileHandle(snapshot.selectedProfileName),
      social: snapshot.profileSocialView ?? undefined,
      tab: snapshot.profileSocialView ? undefined : snapshot.profileTab
    };
  }
  if (snapshot.selectedCommunityId) {
    return { kind: "community", communityId: snapshot.selectedCommunityId };
  }
  if (snapshot.activeRoom === "communities") return { kind: "communities" };
  if (snapshot.activeRoom === "office") {
    return { kind: "workspace", view: snapshot.officeMode === "desk" ? undefined : snapshot.officeMode };
  }
  if (snapshot.activeRoom === "funding") {
    return { kind: "funding" };
  }
  if (snapshot.activeRoom === "opportunities") return { kind: "opportunities" };
  if (
    snapshot.activeRoom === "symposium" ||
    snapshot.activeRoom === "library" ||
    snapshot.activeRoom === "amphitheater"
  ) {
    return { kind: "room", roomId: snapshot.activeRoom };
  }
  return { kind: "hall" };
};

export const snapshotForCanonicalRoute = (
  route: CanonicalRoute,
  resolvePostRoom?: (postId: string) => RoomId | undefined
): ViewSnapshot => ({
  activeRoom: roomForCanonicalRoute(route, resolvePostRoom),
  selectedItemId: route.kind === "post" ? route.postId : null,
  applicationReviewPostId: route.kind === "opportunityApplications" ? route.postId : null,
  selectedApplicationId: route.kind === "opportunityApplications" ? route.applicationId ?? null : null,
  selectedCommentId: route.kind === "post" ? route.commentId ?? null : null,
  selectedProfileName: route.kind === "profile" ? route.handle : null,
  profileSocialView: route.kind === "profile" ? route.social ?? null : null,
  profileTab: route.kind === "profile" ? route.tab ?? "all" : "all",
  officeMode: officeModeForCanonicalRoute(route),
  selectedCommunityId: route.kind === "community" ? route.communityId : null,
  messagesOpen: route.kind === "messages",
  selectedConversationId: route.kind === "messages" ? route.conversationId ?? null : null,
  commentSegmentStacks: {},
  scrollAnchor: null,
  scrollY: 0
});
