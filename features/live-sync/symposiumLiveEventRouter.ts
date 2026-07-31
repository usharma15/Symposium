import type { CanonicalActionActivityContract } from "@/packages/contracts/src";
import type { PostAction } from "@/lib/dataStore";
import type { InquiryItem, ResearchProfile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import type { InquiryLivePayload } from "@/features/inquiry/useInquiryController";
import type { ProfileFollowRecord } from "@/features/profiles/useProfileController";
import { isCanonicalActionActivity } from "@/lib/profileActivity";

export type SymposiumLiveEventPayload = InquiryLivePayload & {
  item?: unknown;
  profile?: unknown;
  follow?: ProfileFollowRecord;
  action?: PostAction;
  activity?: unknown;
};

export type SymposiumLiveEvent = {
  id?: string;
  cursor?: string;
  kind: string;
  actorHandle?: string;
  subjectType: string;
  subjectId: string;
  payload?: SymposiumLiveEventPayload;
  createdAt?: string;
};

export type ScopedLiveEventBuffer<T> = {
  scopeKey: string;
  events: T[];
};

export const scopedLiveEvents = <T,>(
  buffer: ScopedLiveEventBuffer<T>,
  scopeKey: string
) => buffer.scopeKey === scopeKey ? buffer.events : [];

export const appendScopedLiveEvent = <T,>(
  buffer: ScopedLiveEventBuffer<T>,
  scopeKey: string,
  event: T,
  limit: number
): ScopedLiveEventBuffer<T> => ({
  scopeKey,
  events: [
    ...(buffer.scopeKey === scopeKey ? buffer.events : []),
    event
  ].slice(-Math.max(1, limit))
});

export const resetScopedLiveEventBuffer = <T,>(
  buffer: ScopedLiveEventBuffer<T>,
  scopeKey: string
): ScopedLiveEventBuffer<T> =>
  buffer.scopeKey === scopeKey ? buffer : { scopeKey, events: [] };

export type SymposiumLiveRoutingPorts = {
  acceptCanonicalActivity: (activity: CanonicalActionActivityContract) => boolean;
  acceptLiveActionProjection: (input: {
    action: PostAction;
    actorHandle: string;
    commentId?: string;
    item: InquiryItem;
  }) => boolean;
  appendAssistantEvent: (event: SymposiumLiveEvent) => void;
  appendMessagingEvent: (event: SymposiumLiveEvent) => void;
  appendNotificationEvent: (event: SymposiumLiveEvent) => void;
  closeCommentEditor: (commentId: string) => void;
  closeCommentEditorsForPost: (itemId: string) => void;
  closePostEditor: (itemId: string) => void;
  currentActorHandle: () => string;
  dispatchAnalyticsInvalidation: (event: SymposiumLiveEvent) => void;
  dispatchOpportunityApplicationsChange: () => void;
  dispatchScribbleChange: (revision?: number) => void;
  dispatchWorkspaceChange: () => void;
  invalidateQuotedSource: (source: {
    sourceType: "post" | "comment";
    sourceId: string;
    sourcePostId: string;
  }) => void;
  mergeLiveFollow: (
    follow: ProfileFollowRecord | undefined,
    following: boolean
  ) => void;
  mergeLiveItem: (item: InquiryItem) => void;
  mergeLiveMetricPatch: (payload: InquiryLivePayload) => void;
  mergeLiveProfile: (profile: ResearchProfile) => void;
  refreshActivity: () => void;
  refreshAll: () => void;
  touchCommentActivity: (
    itemId: string,
    commentId: string,
    action: PostAction,
    actorHandle: string,
    timestamp: number
  ) => void;
  touchPostActivity: (
    itemId: string,
    action: PostAction,
    actorHandle: string,
    timestamp: number
  ) => void;
};

export const isLiveInquiryItem = (value: unknown): value is InquiryItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as InquiryItem).id === "string" &&
  typeof (value as InquiryItem).title === "string" &&
  typeof (value as InquiryItem).kind === "string" &&
  typeof (value as InquiryItem).room === "string" &&
  typeof (value as InquiryItem).metrics === "object";

export const isLiveResearchProfile = (value: unknown): value is ResearchProfile =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ResearchProfile).handle === "string" &&
  typeof (value as ResearchProfile).name === "string" &&
  Array.isArray((value as ResearchProfile).fields);

const eventTimestamp = (createdAt: string | undefined) => {
  const parsed = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
};

export const routeSymposiumLiveEvent = (
  event: SymposiumLiveEvent,
  ports: SymposiumLiveRoutingPorts
) => {
  const payload = event.payload ?? {};
  ports.dispatchAnalyticsInvalidation(event);

  if (event.kind.startsWith("notification.")) {
    ports.appendNotificationEvent(event);
  }
  if (event.kind.startsWith("assistant.")) {
    ports.appendAssistantEvent(event);
    return;
  }
  if (
    event.kind.startsWith("message.") ||
    event.kind.startsWith("conversation.") ||
    event.kind === "profile.blocked" ||
    event.kind === "profile.unblocked"
  ) {
    ports.appendMessagingEvent(event);
    return;
  }
  if (payload.action && payload.metrics && !isLiveInquiryItem(payload.item)) {
    ports.mergeLiveMetricPatch(payload);
    return;
  }
  if (event.kind === "post.deleted") {
    const deletedPostId = isLiveInquiryItem(payload.item)
      ? payload.item.id
      : typeof payload.itemId === "string"
        ? payload.itemId
        : event.subjectId;
    if (deletedPostId) {
      ports.invalidateQuotedSource({
        sourceType: "post",
        sourceId: deletedPostId,
        sourcePostId: deletedPostId
      });
    }
    if (isLiveInquiryItem(payload.item)) {
      ports.mergeLiveItem(payload.item);
      ports.closePostEditor(payload.item.id);
      ports.closeCommentEditorsForPost(payload.item.id);
    } else {
      ports.refreshAll();
    }
    ports.refreshActivity();
    return;
  }

  if (event.kind === "comment.deleted" && typeof payload.commentId === "string") {
    const sourcePostId = isLiveInquiryItem(payload.item)
      ? payload.item.id
      : typeof payload.itemId === "string"
        ? payload.itemId
        : "";
    if (sourcePostId) {
      ports.invalidateQuotedSource({
        sourceType: "comment",
        sourceId: payload.commentId,
        sourcePostId
      });
    }
    ports.closeCommentEditor(payload.commentId);
  }

  if (
    payload.follow ||
    event.kind === "profile.followed" ||
    event.kind === "profile.unfollowed"
  ) {
    ports.mergeLiveFollow(payload.follow, event.kind !== "profile.unfollowed");
  }

  if (
    event.kind === "profile.updated" &&
    isLiveResearchProfile(payload.profile)
  ) {
    ports.mergeLiveProfile(payload.profile);
    return;
  }

  if (isLiveInquiryItem(payload.item)) {
    const action = payload.action;
    if (action === "read") {
      ports.mergeLiveItem(payload.item);
      return;
    }
    const canonicalActivity = isCanonicalActionActivity(payload.activity)
      ? payload.activity
      : null;
    if (
      canonicalActivity &&
      !ports.acceptCanonicalActivity(canonicalActivity)
    ) {
      return;
    }
    const currentActorHandle = ports.currentActorHandle();
    if (
      !canonicalActivity &&
      action &&
      event.actorHandle &&
      cleanHandle(event.actorHandle) === cleanHandle(currentActorHandle)
    ) {
      const timestamp = eventTimestamp(event.createdAt);
      if (typeof payload.commentId === "string") {
        if (!ports.acceptLiveActionProjection({
          action,
          actorHandle: currentActorHandle,
          commentId: payload.commentId,
          item: payload.item
        })) return;
        ports.touchCommentActivity(
          payload.item.id,
          payload.commentId,
          action,
          currentActorHandle,
          timestamp
        );
      } else {
        if (!ports.acceptLiveActionProjection({
          action,
          actorHandle: currentActorHandle,
          item: payload.item
        })) return;
        ports.touchPostActivity(
          payload.item.id,
          action,
          currentActorHandle,
          timestamp
        );
      }
    }

    ports.mergeLiveItem(payload.item);
    ports.refreshActivity();
    return;
  }

  if (
    event.kind.startsWith("post.") ||
    event.kind.startsWith("comment.") ||
    event.kind.startsWith("profile.") ||
    event.kind.startsWith("community.") ||
    event.kind.startsWith("note.") ||
    event.kind.startsWith("opportunity.application.") ||
    event.kind.startsWith("scribble.")
  ) {
    if (event.kind.startsWith("note.")) {
      ports.dispatchWorkspaceChange();
    }
    if (event.kind.startsWith("scribble.")) {
      ports.dispatchScribbleChange(
        typeof payload.revision === "number" ? payload.revision : undefined
      );
    }
    if (event.kind.startsWith("opportunity.application.")) {
      ports.dispatchOpportunityApplicationsChange();
    }
    ports.refreshAll();
  }
};
