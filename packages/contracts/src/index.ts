import { z } from "zod";

export const roomIdSchema = z.enum([
  "hall",
  "office",
  "symposium",
  "library",
  "amphitheater",
  "funding",
  "communities",
  "opportunities"
]);

export const postRoomSchema = z.enum([
  "office",
  "symposium",
  "library",
  "amphitheater",
  "funding",
  "communities",
  "opportunities"
]);

export const contentKindSchema = z.enum(["paper", "thought", "draft", "note", "code"]);
export const postActionSchema = z.enum(["signal", "save", "fork", "read"]);
export const communityVisibilitySchema = z.enum(["public", "private"]);
export const callStatusSchema = z.enum(["quiet", "voice live", "video live"]);
export const liveCallStatusSchema = z.enum(["scheduled", "live", "ended", "cancelled"]);
export const liveCallKindSchema = z.enum(["voice", "video"]);
export const patronageVisibilitySchema = z.enum(["civic", "private"]);
export const attachmentStatusSchema = z.enum(["pending", "uploaded", "previewed", "failed"]);
export const followStatusSchema = z.enum(["active", "muted", "blocked"]);
export const opportunityStatusSchema = z.enum(["open", "closed", "draft"]);
export const opportunityKindSchema = z.enum(["job", "bounty", "collaboration", "grant", "internship"]);
export const aiMessageRoleSchema = z.enum(["user", "assistant", "system"]);

export const researchProfileSchema = z.object({
  name: z.string().min(1),
  handle: z.string().min(1),
  email: z.string().email().optional(),
  avatarUrl: z.string().url().optional(),
  likesPublic: z.boolean().optional(),
  resharesPublic: z.boolean().optional(),
  role: z.string().min(1),
  location: z.string().min(1),
  bio: z.string(),
  fields: z.array(z.string()).default([])
});

export const createProfileInputSchema = z.object({
  name: z.string().trim().min(1),
  handle: z.string().trim().min(1),
  email: z.string().trim().email().optional().or(z.literal("")),
  avatarUrl: z.string().trim().url().optional().or(z.literal("")),
  likesPublic: z.boolean().optional(),
  resharesPublic: z.boolean().optional(),
  role: z.string().trim().default("Symposium participant"),
  location: z.string().trim().default("Public rooms"),
  bio: z.string().trim().max(200).default("A participant in the current inquiry thread."),
  fields: z.array(z.string()).default([])
});

export const inquiryMetricsSchema = z.object({
  signal: z.string(),
  critiques: z.string(),
  forks: z.string(),
  saves: z.string(),
  reads: z.string()
});

export const inquirySignalSchema = z.object({
  label: z.string(),
  value: z.string()
});

export type InquiryCommentContract = {
  id?: string;
  parentId?: string | null;
  author: string;
  authorHandle?: string;
  body: string;
  stance: string;
  createdAt?: string;
  replies?: InquiryCommentContract[];
};

export const inquiryCommentSchema: z.ZodType<InquiryCommentContract> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    parentId: z.string().nullable().optional(),
    author: z.string(),
    authorHandle: z.string().optional(),
    body: z.string(),
    stance: z.string(),
    createdAt: z.string().optional(),
    replies: z.array(inquiryCommentSchema).optional()
  })
);

export const inquiryItemSchema = z.object({
  id: z.string(),
  kind: contentKindSchema,
  room: postRoomSchema,
  title: z.string(),
  author: z.string(),
  authorHandle: z.string().optional(),
  affiliation: z.string(),
  date: z.string(),
  createdAt: z.string().optional(),
  status: z.string(),
  metrics: inquiryMetricsSchema,
  gatheringReason: z.string(),
  excerpt: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  signals: z.array(inquirySignalSchema),
  claims: z.array(z.string()),
  objections: z.array(z.string()),
  evidence: z.array(z.string()),
  tests: z.array(z.string()),
  forks: z.array(z.string()),
  comments: z.array(inquiryCommentSchema),
  saved: z.boolean().optional(),
  savedBy: z.array(z.string()).optional(),
  signaledBy: z.array(z.string()).optional(),
  forkedBy: z.array(z.string()).optional()
});

export const researchCommunitySchema = z.object({
  id: z.string(),
  name: z.string(),
  field: z.string(),
  summary: z.string(),
  visibility: communityVisibilitySchema,
  online: z.number().int().nonnegative(),
  memberHandles: z.array(z.string()),
  keywords: z.array(z.string()),
  seedCounts: z.object({
    papers: z.number().int().nonnegative(),
    thoughts: z.number().int().nonnegative(),
    opportunities: z.number().int().nonnegative()
  }),
  callStatus: callStatusSchema
});

export const authSyncInputSchema = z.object({
  clerkUserId: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
  handle: z.string().optional(),
  imageUrl: z.string().url().optional()
});

export const createPostInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(20000),
  kind: contentKindSchema,
  room: postRoomSchema,
  authorHandle: z.string().optional()
});

export const createCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  stance: z.string().trim().min(1).default("Comment"),
  parentId: z.string().nullable().optional(),
  authorHandle: z.string().optional()
});

export const postActionInputSchema = z.object({
  action: postActionSchema,
  actorHandle: z.string().optional(),
  active: z.boolean().optional()
});

export const joinCommunityInputSchema = z.object({
  communityId: z.string().min(1)
});

export const followProfileInputSchema = z.object({
  targetHandle: z.string().trim().min(1),
  status: followStatusSchema.default("active")
});

export const unfollowProfileInputSchema = z.object({
  targetHandle: z.string().trim().min(1)
});

export const createCommunityCallInputSchema = z.object({
  communityId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  kind: liveCallKindSchema.default("voice"),
  startsAt: z.string().datetime().optional(),
  provider: z.string().trim().max(80).optional(),
  providerRoomId: z.string().trim().max(160).optional()
});

export const callIdInputSchema = z.object({
  callId: z.string().min(1)
});

export const createOpportunityInputSchema = z.object({
  title: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(20000),
  kind: opportunityKindSchema.default("job"),
  communityId: z.string().optional(),
  location: z.string().trim().max(160).optional(),
  compensation: z.string().trim().max(160).optional(),
  status: opportunityStatusSchema.default("open"),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([])
});

export const createAttachmentUploadInputSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(160),
  byteSize: z.number().int().positive().max(50 * 1024 * 1024),
  ownerType: z.enum(["post", "message", "note", "profile"]),
  ownerId: z.string().optional()
});

export const confirmAttachmentInputSchema = z.object({
  attachmentId: z.string().min(1),
  byteSize: z.number().int().positive().optional()
});

export const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(160),
  limit: z.number().int().positive().max(50).default(12)
});

export const sendMessageInputSchema = z.object({
  conversationId: z.string().optional(),
  recipientHandle: z.string().optional(),
  body: z.string().trim().min(1).max(8000)
});

export const saveNoteBlockInputSchema = z.object({
  workspaceId: z.string().optional(),
  noteId: z.string().optional(),
  blockId: z.string().optional(),
  body: z.string().max(50000),
  visibility: z.enum(["private", "community", "public"]).default("private")
});

export const publishNoteInputSchema = z.object({
  noteId: z.string().optional(),
  title: z.string().trim().min(1).max(240).optional(),
  body: z.string().trim().min(1).max(50000).optional(),
  visibility: z.enum(["private", "community", "public"]).default("public")
});

export const assistantMessageInputSchema = z.object({
  conversationId: z.string().optional(),
  message: z.string().trim().min(1).max(12000),
  contextType: z.enum(["general", "room", "post", "community", "note"]).default("general"),
  contextId: z.string().optional()
});

export const markNotificationInputSchema = z.object({
  notificationId: z.string().min(1)
});

export const profileFollowSchema = z.object({
  followerHandle: z.string(),
  followingHandle: z.string(),
  status: followStatusSchema,
  createdAt: z.string().optional()
});

export const communityCallSchema = z.object({
  id: z.string(),
  communityId: z.string(),
  hostHandle: z.string().optional(),
  title: z.string(),
  kind: liveCallKindSchema,
  status: liveCallStatusSchema,
  startsAt: z.string().optional(),
  endedAt: z.string().optional(),
  provider: z.string().optional(),
  providerRoomId: z.string().optional(),
  participantHandles: z.array(z.string()).default([])
});

export const opportunitySchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  kind: opportunityKindSchema,
  status: opportunityStatusSchema,
  creatorHandle: z.string().optional(),
  communityId: z.string().optional(),
  location: z.string().optional(),
  compensation: z.string().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().optional()
});

export const assistantMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: aiMessageRoleSchema,
  body: z.string(),
  createdAt: z.string().optional()
});

export const assistantResponseSchema = z.object({
  conversationId: z.string(),
  message: assistantMessageSchema,
  providerConfigured: z.boolean(),
  status: z.enum(["answered", "provider_not_configured"])
});

export const bootstrapResponseSchema = z.object({
  profiles: z.record(z.string(), researchProfileSchema),
  items: z.array(inquiryItemSchema),
  communities: z.array(researchCommunitySchema).optional(),
  defaultProfile: researchProfileSchema
});

export type RoomIdContract = z.infer<typeof roomIdSchema>;
export type ContentKindContract = z.infer<typeof contentKindSchema>;
export type PostActionContract = z.infer<typeof postActionSchema>;
export type ResearchProfileContract = z.infer<typeof researchProfileSchema>;
export type CreateProfileInputContract = z.infer<typeof createProfileInputSchema>;
export type InquiryItemContract = z.infer<typeof inquiryItemSchema>;
export type ResearchCommunityContract = z.infer<typeof researchCommunitySchema>;
export type CreatePostInputContract = z.infer<typeof createPostInputSchema>;
export type CreateCommentInputContract = z.infer<typeof createCommentInputSchema>;
export type PostActionInputContract = z.infer<typeof postActionInputSchema>;
export type AttachmentStatusContract = z.infer<typeof attachmentStatusSchema>;
export type BootstrapResponseContract = z.infer<typeof bootstrapResponseSchema>;
export type FollowProfileInputContract = z.infer<typeof followProfileInputSchema>;
export type ProfileFollowContract = z.infer<typeof profileFollowSchema>;
export type CommunityCallContract = z.infer<typeof communityCallSchema>;
export type CreateCommunityCallInputContract = z.infer<typeof createCommunityCallInputSchema>;
export type OpportunityContract = z.infer<typeof opportunitySchema>;
export type CreateOpportunityInputContract = z.infer<typeof createOpportunityInputSchema>;
export type PublishNoteInputContract = z.infer<typeof publishNoteInputSchema>;
export type AssistantMessageInputContract = z.infer<typeof assistantMessageInputSchema>;
export type AssistantResponseContract = z.infer<typeof assistantResponseSchema>;

export const procedureNames = [
  "auth.syncUser",
  "bootstrap.getInitialState",
  "profiles.getMe",
  "profiles.update",
  "profiles.follow",
  "profiles.unfollow",
  "profiles.following",
  "posts.create",
  "posts.getFeed",
  "posts.getDetail",
  "posts.react",
  "posts.save",
  "comments.create",
  "comments.list",
  "communities.list",
  "communities.get",
  "communities.joinOrRequest",
  "communities.listCalls",
  "communities.createCall",
  "communities.joinCall",
  "communities.endCall",
  "attachments.createUpload",
  "attachments.confirmUpload",
  "opportunities.list",
  "opportunities.create",
  "search.query",
  "notifications.list",
  "notifications.markRead",
  "messages.listConversations",
  "messages.send",
  "notes.getWorkspace",
  "notes.saveBlock",
  "notes.publish",
  "assistant.ask"
] as const;

export type ProcedureNameContract = (typeof procedureNames)[number];
