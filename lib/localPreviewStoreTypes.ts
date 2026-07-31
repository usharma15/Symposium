import type {
  CanonicalActionActivityContract,
  ContentQuoteContract,
  OpportunityPostInputContract,
  PatronageProposalInputContract,
  PostTypeContract,
  VersionedDocumentContract
} from "@/packages/contracts/src";
import type {
  ContentKind,
  InquiryAttachment,
  InquiryItem,
  RoomId
} from "@/lib/mockData";

export type CreateProfileInput = {
  name: string;
  handle: string;
  email?: string;
  avatarUrl?: string;
  likesPublic?: boolean;
  resharesPublic?: boolean;
  role: string;
  location: string;
  bio: string;
  fields: string[];
};

export type CreatePostInput = {
  title: string;
  body: string;
  document?: VersionedDocumentContract;
  kind: ContentKind;
  postType: PostTypeContract;
  room: Exclude<RoomId, "hall">;
  communityId?: string;
  attachments?: InquiryAttachment[];
  quote?: ContentQuoteContract;
  patronage?: PatronageProposalInputContract;
  opportunity?: OpportunityPostInputContract;
};

export type CreateCommentInput = {
  id?: string;
  body: string;
  document?: VersionedDocumentContract;
  stance: string;
  parentId?: string | null;
  attachments?: InquiryAttachment[];
  quote?: ContentQuoteContract;
};

export type ActionMutationResult = {
  item: InquiryItem;
  activity?: CanonicalActionActivityContract;
};

export type UpdatePostInput = {
  title: string;
  body: string;
  document?: VersionedDocumentContract;
  attachments?: InquiryAttachment[];
  quote?: ContentQuoteContract | null;
  patronage?: PatronageProposalInputContract;
  opportunity?: OpportunityPostInputContract;
};

export type UpdateCommentInput = {
  body: string;
  document?: VersionedDocumentContract;
  attachments?: InquiryAttachment[];
  quote?: ContentQuoteContract | null;
};
