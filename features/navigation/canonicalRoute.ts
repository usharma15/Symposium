export type CanonicalRoute =
  | { kind: "hall" }
  | { kind: "room"; roomId: CanonicalRoomId }
  | { kind: "workspace"; view?: "saved" | "notes" }
  | { kind: "funding"; view?: "civic" | "private" }
  | { kind: "opportunities" }
  | { kind: "messages"; conversationId?: string }
  | { kind: "post"; postId: string; commentId?: string }
  | { kind: "profile"; handle: string; social?: ProfileSocialView }
  | { kind: "communities" }
  | { kind: "community"; communityId: string };

export const canonicalRoomIds = ["symposium", "library", "amphitheater"] as const;
export type CanonicalRoomId = (typeof canonicalRoomIds)[number];
export type ProfileSocialView = "followers" | "following";

export const canonicalRouteForRoom = (roomId: string): CanonicalRoute => {
  if (roomId === "hall") return { kind: "hall" };
  if (roomId === "office") return { kind: "workspace" };
  if (roomId === "funding") return { kind: "funding" };
  if (roomId === "communities") return { kind: "communities" };
  if (roomId === "opportunities") return { kind: "opportunities" };
  if (canonicalRoomIds.includes(roomId as CanonicalRoomId)) {
    return { kind: "room", roomId: roomId as CanonicalRoomId };
  }
  return { kind: "hall" };
};

const cleanSegment = (value: string | undefined) => {
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

const encoded = (value: string) => encodeURIComponent(value.trim());

export const canonicalRouteHref = (route: CanonicalRoute) => {
  if (route.kind === "room") return `/rooms/${route.roomId}`;
  if (route.kind === "workspace") return route.view ? `/workspace?view=${route.view}` : "/workspace";
  if (route.kind === "funding") return route.view ? `/funding?view=${route.view}` : "/funding";
  if (route.kind === "opportunities") return "/opportunities";
  if (route.kind === "messages") {
    return route.conversationId ? `/messages?conversation=${encoded(route.conversationId)}` : "/messages";
  }
  if (route.kind === "post") {
    const base = `/posts/${encoded(route.postId)}`;
    return route.commentId ? `${base}?comment=${encoded(route.commentId)}` : base;
  }
  if (route.kind === "profile") {
    const base = `/profiles/${encoded(route.handle.replace(/^@/, ""))}`;
    return route.social ? `${base}/${route.social}` : base;
  }
  if (route.kind === "communities") return "/communities";
  if (route.kind === "community") return `/communities/${encoded(route.communityId)}`;
  return "/";
};

export const parseCanonicalRoute = (pathname: string, search = ""): CanonicalRoute => {
  const segments = pathname.split("/").filter(Boolean).map(cleanSegment);
  if (segments[0] === "rooms" && canonicalRoomIds.includes(segments[1] as CanonicalRoomId)) {
    return { kind: "room", roomId: segments[1] as CanonicalRoomId };
  }
  if (segments[0] === "workspace") {
    const view = new URLSearchParams(search).get("view");
    return { kind: "workspace", view: view === "saved" || view === "notes" ? view : undefined };
  }
  if (segments[0] === "funding") {
    const view = new URLSearchParams(search).get("view");
    return { kind: "funding", view: view === "civic" || view === "private" ? view : undefined };
  }
  if (segments[0] === "opportunities") return { kind: "opportunities" };
  if (segments[0] === "messages") {
    const conversationId = new URLSearchParams(search).get("conversation")?.trim() || undefined;
    return conversationId ? { kind: "messages", conversationId } : { kind: "messages" };
  }
  if (segments[0] === "posts" && segments[1]) {
    const commentId = new URLSearchParams(search).get("comment")?.trim() || undefined;
    return { kind: "post", postId: segments[1], commentId };
  }
  if (segments[0] === "profiles" && segments[1]) {
    const social = segments[2] === "followers" || segments[2] === "following" ? segments[2] : undefined;
    const handle = `@${segments[1].replace(/^@/, "")}`;
    return social ? { kind: "profile", handle, social } : { kind: "profile", handle };
  }
  if (segments[0] === "communities" && segments[1]) {
    return { kind: "community", communityId: segments[1] };
  }
  if (segments[0] === "communities") return { kind: "communities" };
  return { kind: "hall" };
};
