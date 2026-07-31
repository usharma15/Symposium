export type {
  ProfileSocialView,
  ProfileTab
} from "@/features/navigation/canonicalRoute";

export type ProfileActivityKind =
  | "authored"
  | "comments"
  | "fork"
  | "signal"
  | "save";

export type ProfileCommentActivityKind = Exclude<
  ProfileActivityKind,
  "authored"
>;

export type ProfileSocialLists = {
  following: string[];
  followers: string[];
};

export type ProfileSettingsDraft = {
  avatarUrl?: string;
  name: string;
  bio: string;
  likesPublic: boolean;
  resharesPublic: boolean;
};
