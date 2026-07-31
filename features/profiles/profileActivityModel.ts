import type { PostAction } from "@/lib/symposiumCore";
import type { InquiryComment } from "@/lib/mockData";
import type {
  CanonicalActionActivityContract,
  ProfileActivityCountsContract,
  ToggleActionContract
} from "@/packages/contracts/src";
import { emptyProfileActivityCounts } from "@/lib/profileActivity";
import type {
  ProfileCommentActivityKind,
  ProfileTab
} from "@/features/profiles/profileTypes";

export type ProfileActivityPageScope =
  | "all"
  | "comments"
  | "reshares"
  | "likes"
  | "saved";

export type ProfileActivityPageState = {
  loaded: boolean;
  loading: boolean;
  nextCursor: string | null;
  commentsNextCursor: string | null;
  stale?: boolean;
};

export type ProfileActivitySnapshot = {
  entries: CanonicalActionActivityContract[];
  loaded: boolean;
  nextCursor: string | null;
  pages: Partial<Record<ProfileActivityPageScope, ProfileActivityPageState>>;
  hiddenCommunityCounts: ProfileActivityCountsContract;
  totals?: ProfileActivityCountsContract;
};

export const profileActivityScopeForTab = (
  tab: ProfileTab
): ProfileActivityPageScope => {
  if (
    tab === "comments" ||
    tab === "reshares" ||
    tab === "likes" ||
    tab === "saved"
  ) {
    return tab;
  }
  return "all";
};

export const profileActivityActionsForScope = (
  scope: ProfileActivityPageScope
): ToggleActionContract[] => {
  if (scope === "likes") return ["signal"];
  if (scope === "saved") return ["save"];
  if (scope === "reshares" || scope === "all") return ["fork"];
  return [];
};

export const profileActivityCommentModeForScope = (
  scope: ProfileActivityPageScope
): "all" | "none" =>
  scope === "all" || scope === "comments" ? "all" : "none";

export const profileActivityScopeIncludesComments = (
  scope: ProfileActivityPageScope
) => profileActivityCommentModeForScope(scope) !== "none";

export const profileTabUsesAuthoredPosts = (tab: ProfileTab) =>
  tab === "all" ||
  tab === "papers" ||
  tab === "thoughts" ||
  tab === "proposals" ||
  tab === "opportunities" ||
  tab === "reshares";

export const emptyProfileActivitySnapshot = (): ProfileActivitySnapshot => ({
  entries: [],
  loaded: false,
  nextCursor: null,
  pages: {},
  hiddenCommunityCounts: emptyProfileActivityCounts()
});

export const profileActivityKey = (
  handle: string,
  action: PostAction,
  itemId: string
) => `profile:${handle}:${action}:${itemId}`;

export const profileCommentActivityKey = (
  handle: string,
  action: Exclude<ProfileCommentActivityKind, "comments">,
  itemId: string,
  commentId: string
) => `profile:${handle}:${action}:${itemId}:comment:${commentId}`;

export const commentTimestampScore = (comment: InquiryComment) => {
  const parsed = comment.createdAt ? Date.parse(comment.createdAt) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};
