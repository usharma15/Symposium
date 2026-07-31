import type { MutableRefObject } from "react";
import type {
  CommunityCallContract,
  PostPageQueryContract
} from "@/packages/contracts/src";
import type {
  InquiryItem,
  ResearchCommunity,
  ResearchProfile
} from "@/lib/mockData";

export type ProfileRetryMutationPort = {
  acquire: (
    scope: string,
    fingerprint: string
  ) => {
    fingerprintKey: string;
    idempotencyKey: string;
  };
  clear: (fingerprintKey: string) => void;
};

export type ProfileInquiryPort = {
  beginRefresh: () => (
    items: InquiryItem[],
    actorHandle: string
  ) => void;
  findItem: (itemId: string) => InquiryItem | undefined;
  hydrateCachedSnapshot: (storedProfileHandle: string | null) => {
    profiles: Record<string, ResearchProfile>;
    currentProfile: ResearchProfile;
    communities?: ResearchCommunity[];
  };
  loadPostPage: (
    key: string,
    query: PostPageQueryContract,
    append?: boolean
  ) => Promise<void>;
  loadPostSubjects: (
    postIds: string[],
    commentIds: string[],
    actorHandle: string
  ) => Promise<unknown>;
  mergeBoundedRead: (
    data: {
      items: InquiryItem[];
      profiles: Record<string, ResearchProfile>;
    },
    options?: { persist?: boolean }
  ) => void;
  persistSnapshot: () => void;
  projectProfile: (
    profile: ResearchProfile,
    options?: { persist?: boolean }
  ) => void;
};

export type ProfileEnvironmentPort = {
  applyBootstrap: (data: {
    communities?: ResearchCommunity[];
    communityCalls?: Record<string, CommunityCallContract[]>;
  }) => void;
};

export type ProfileControllerBridgeRefs = {
  environmentRef: MutableRefObject<ProfileEnvironmentPort | null>;
  inquiryRef: MutableRefObject<ProfileInquiryPort | null>;
};
