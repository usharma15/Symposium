import type { CommentAction, PostAction } from "@/lib/dataStore";

export type ViewTrigger = "visibility" | "click" | "expand";
export type ViewSurface = "feed" | "profile" | "detail" | "thread" | "search" | "community";
export type ViewActionOptions = {
  trigger?: ViewTrigger;
  surface?: ViewSurface;
};

export type PostActionHandler = (
  itemId: string,
  action: PostAction,
  options?: ViewActionOptions
) => void;

export type CommentActionHandler = (
  itemId: string,
  commentId: string,
  action: CommentAction,
  options?: ViewActionOptions
) => void;
