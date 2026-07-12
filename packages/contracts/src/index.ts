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
export const toggleActionSchema = z.enum(["signal", "save", "fork"]);
export const actionSubjectTypeSchema = z.enum(["post", "comment"]);
export const communityVisibilitySchema = z.enum(["public", "private"]);
export const callStatusSchema = z.enum(["quiet", "voice live", "video live"]);
export const liveCallStatusSchema = z.enum(["scheduled", "live", "ended", "cancelled"]);
export const liveCallKindSchema = z.enum(["voice", "video"]);
export const patronageVisibilitySchema = z.enum(["civic", "private"]);
export const attachmentStatusSchema = z.enum(["pending", "uploaded", "previewed", "failed"]);
export const attachmentKindSchema = z.enum(["image", "video", "pdf", "text", "document"]);
export const followStatusSchema = z.enum(["active", "muted", "blocked"]);
export const opportunityStatusSchema = z.enum(["open", "closed", "draft"]);
export const opportunityKindSchema = z.enum(["job", "bounty", "collaboration", "grant", "internship"]);
export const aiMessageRoleSchema = z.enum(["user", "assistant", "system"]);
export const resourceTypeSchema = z.enum([
  "post",
  "comment",
  "profile",
  "community",
  "conversation",
  "message",
  "workspace",
  "note",
  "opportunity",
  "attachment"
]);
export const resourceVisibilitySchema = z.enum(["private", "restricted", "community", "public"]);
export const resourceLifecycleSchema = z.enum(["draft", "active", "archived", "deleted"]);

export const isSafeExternalUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
};

export const safeExternalUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine(isSafeExternalUrl, "Use an http or https URL without embedded credentials.");

export const resourceReferenceSchema = z.object({
  type: resourceTypeSchema,
  id: z.string().trim().min(1).max(240),
  label: z.string().trim().min(1).max(300).optional()
});

const textMarksSchema = z.array(z.enum(["bold", "italic", "code", "strikethrough"])).max(4).default([]);
export const documentTextSchema = z.object({
  text: z.string(),
  marks: textMarksSchema.optional(),
  link: safeExternalUrlSchema.optional()
});

export const documentNodeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), content: z.array(documentTextSchema).default([]) }),
  z.object({
    type: z.literal("heading"),
    level: z.number().int().min(1).max(4),
    content: z.array(documentTextSchema).default([])
  }),
  z.object({ type: z.literal("list"), ordered: z.boolean().default(false), items: z.array(z.string()).max(200) }),
  z.object({ type: z.literal("code"), language: z.string().max(80).optional(), code: z.string().max(100000) }),
  z.object({ type: z.literal("attachment"), attachmentId: z.string().min(1), caption: z.string().max(1000).optional() }),
  z.object({ type: z.literal("quote"), content: z.array(documentTextSchema).default([]), source: resourceReferenceSchema.optional() }),
  z.object({ type: z.literal("reference"), resource: resourceReferenceSchema }),
  z.object({ type: z.literal("citation"), label: z.string().max(120), href: safeExternalUrlSchema.optional() })
]);

export const versionedDocumentSchema = z.object({
  version: z.literal(1),
  nodes: z.array(documentNodeSchema).max(2000)
});

export const researchProfileSchema = z.object({
  name: z.string().min(1),
  handle: z.string().min(1),
  email: z.string().email().optional(),
  avatarUrl: safeExternalUrlSchema.optional(),
  likesPublic: z.boolean().optional(),
  resharesPublic: z.boolean().optional(),
  role: z.string().min(1),
  location: z.string().min(1),
  bio: z.string(),
  fields: z.array(z.string()).default([]),
  revision: z.number().int().positive().optional()
});

export const createProfileInputSchema = z.object({
  name: z.string().trim().min(1),
  handle: z.string().trim().min(1),
  email: z.string().trim().email().optional().or(z.literal("")),
  avatarUrl: safeExternalUrlSchema.optional().or(z.literal("")),
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
export type InquiryMetricsContract = z.infer<typeof inquiryMetricsSchema>;

export const inquirySignalSchema = z.object({
  label: z.string(),
  value: z.string()
});

const attachmentMetadataDepth = (value: unknown, depth = 0): number => {
  if (!value || typeof value !== "object") return depth;
  const entries = Array.isArray(value) ? value : Object.values(value);
  return entries.reduce((maximum, entry) => Math.max(maximum, attachmentMetadataDepth(entry, depth + 1)), depth);
};

export const attachmentMetadataSchema = z
  .record(z.string().min(1).max(80), z.unknown())
  .superRefine((metadata, context) => {
    if (Object.keys(metadata).length > 64) {
      context.addIssue({ code: "custom", message: "Attachment metadata can contain at most 64 fields." });
    }
    if (attachmentMetadataDepth(metadata) > 8) {
      context.addIssue({ code: "custom", message: "Attachment metadata is nested too deeply." });
    }
    if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > 64 * 1024) {
      context.addIssue({ code: "custom", message: "Attachment metadata must be 64 KB or smaller." });
    }
  })
  .default({});

export const inquiryAttachmentSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(160),
  byteSize: z.number().int().positive(),
  url: safeExternalUrlSchema.optional(),
  status: attachmentStatusSchema.default("uploaded"),
  kind: attachmentKindSchema,
  metadata: attachmentMetadataSchema.optional(),
  createdAt: z.string().optional()
});

export const postAttachmentInputSchema = inquiryAttachmentSchema.pick({
  id: true,
  fileName: true,
  contentType: true,
  byteSize: true,
  url: true,
  kind: true,
  metadata: true
});

export const postAttachmentIdSchema = z.string().uuid();

export const contentQuoteSourceSchema = z.object({
  sourceType: z.enum(["post", "comment"]),
  sourceId: z.string().trim().min(1).max(200)
});

export const contentQuoteSchema = z.object({
  sourceType: z.enum(["post", "comment"]),
  sourceId: z.string().min(1).max(200),
  sourcePostId: z.string().min(1).max(200),
  sourceRevision: z.number().int().positive().optional(),
  available: z.boolean(),
  author: z.string().optional(),
  authorHandle: z.string().optional(),
  title: z.string().optional(),
  kind: contentKindSchema.optional(),
  body: z.string().optional(),
  createdAt: z.string().optional(),
  attachmentCount: z.number().int().min(0).max(10).default(0)
});

export type ContentQuoteContract = z.infer<typeof contentQuoteSchema>;
export type ContentQuoteSourceContract = z.infer<typeof contentQuoteSourceSchema>;

export type InquiryCommentContract = {
  id?: string;
  parentId?: string | null;
  author: string;
  authorHandle?: string;
  body: string;
  stance: string;
  createdAt?: string;
  editedAt?: string;
  deletedAt?: string;
  revision?: number;
  metrics?: Pick<InquiryMetricsContract, "signal" | "forks" | "saves" | "reads">;
  savedBy?: string[];
  signaledBy?: string[];
  forkedBy?: string[];
  attachments?: InquiryAttachmentContract[];
  quote?: ContentQuoteContract;
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
    editedAt: z.string().optional(),
    deletedAt: z.string().optional(),
    revision: z.number().int().positive().optional(),
    metrics: inquiryMetricsSchema.pick({ signal: true, forks: true, saves: true, reads: true }).optional(),
    savedBy: z.array(z.string()).optional(),
    signaledBy: z.array(z.string()).optional(),
    forkedBy: z.array(z.string()).optional(),
    attachments: z.array(inquiryAttachmentSchema).max(10).optional(),
    quote: contentQuoteSchema.optional(),
    replies: z.array(inquiryCommentSchema).optional()
  })
);

export const inquiryItemSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive().optional(),
  kind: contentKindSchema,
  room: postRoomSchema,
  title: z.string(),
  author: z.string(),
  authorHandle: z.string().optional(),
  affiliation: z.string(),
  date: z.string(),
  createdAt: z.string().optional(),
  editedAt: z.string().optional(),
  deletedAt: z.string().optional(),
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
  attachments: z.array(inquiryAttachmentSchema).optional(),
  quote: contentQuoteSchema.optional(),
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
  clerkUserId: z.string().trim().min(1).max(200).optional(),
  email: z.string().email().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  handle: z.string().trim().min(1).max(80).optional(),
  imageUrl: safeExternalUrlSchema.optional()
});

export const createPostInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(20000),
  kind: contentKindSchema,
  room: postRoomSchema,
  authorHandle: z.string().optional(),
  attachmentIds: z.array(postAttachmentIdSchema).max(10).optional(),
  quoteSource: contentQuoteSourceSchema.optional(),
  attachments: z.array(postAttachmentInputSchema).max(10).default([])
}).superRefine((input, context) => {
  if (!input.attachmentIds?.length || !input.attachments.length) return;
  const legacyIds = input.attachments.map((attachment) => attachment.id);
  if (
    input.attachmentIds.length !== legacyIds.length ||
    input.attachmentIds.some((attachmentId, index) => attachmentId !== legacyIds[index])
  ) {
    context.addIssue({
      code: "custom",
      path: ["attachmentIds"],
      message: "Attachment references do not match the supplied attachment records."
    });
  }
});

export const updatePostInputSchema = z.object({
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(20000),
  expectedEditedAt: z.string().datetime().nullable().optional(),
  attachmentIds: z.array(postAttachmentIdSchema).max(10).optional(),
  quoteSource: contentQuoteSourceSchema.nullable().optional(),
  actorHandle: z.string().optional()
}).superRefine((input, context) => {
  if ((input.attachmentIds !== undefined || input.quoteSource !== undefined) && input.expectedEditedAt === undefined) {
    context.addIssue({
      code: "custom",
      path: ["expectedEditedAt"],
      message: "Editing post attachments or its quote requires the content version that was loaded."
    });
  }
});

export const createCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  stance: z.string().trim().min(1).default("Comment"),
  parentId: z.string().nullable().optional(),
  attachmentIds: z.array(postAttachmentIdSchema).max(10).optional(),
  quoteSource: contentQuoteSourceSchema.optional(),
  authorHandle: z.string().optional()
});

export const updateCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  expectedEditedAt: z.string().datetime().nullable().optional(),
  attachmentIds: z.array(postAttachmentIdSchema).max(10).optional(),
  quoteSource: contentQuoteSourceSchema.nullable().optional(),
  actorHandle: z.string().optional()
}).superRefine((input, context) => {
  if ((input.attachmentIds !== undefined || input.quoteSource !== undefined) && input.expectedEditedAt === undefined) {
    context.addIssue({
      code: "custom",
      path: ["expectedEditedAt"],
      message: "Editing comment attachments or its quote requires the content version that was loaded."
    });
  }
});

export const postActionInputSchema = z.object({
  action: postActionSchema,
  actorHandle: z.string().optional(),
  active: z.boolean().optional(),
  trigger: z.enum(["visibility", "click", "expand"]).optional(),
  surface: z.enum(["feed", "profile", "detail", "thread", "search", "community"]).optional()
});
export const commentActionInputSchema = postActionInputSchema;

export const canonicalActionActivitySchema = z.object({
  subjectType: actionSubjectTypeSchema,
  subjectId: z.string().min(1),
  postId: z.string().min(1),
  actorHandle: z.string().min(1),
  action: toggleActionSchema,
  active: z.boolean(),
  count: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  occurredAt: z.string().datetime()
});

export const profileActivityQuerySchema = z.object({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200)
});

export const profileActivityResponseSchema = z.object({
  entries: z.array(canonicalActionActivitySchema),
  nextCursor: z.string().nullable()
});

export const joinCommunityInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120)
});

export const followProfileInputSchema = z.object({
  targetHandle: z.string().trim().min(1).max(80),
  status: followStatusSchema.default("active")
});

export const unfollowProfileInputSchema = z.object({
  targetHandle: z.string().trim().min(1).max(80),
  actorHandle: z.string().trim().max(80).optional()
});

export const createCommunityCallInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  kind: liveCallKindSchema.default("voice"),
  startsAt: z.string().datetime().optional(),
  provider: z.string().trim().max(80).optional(),
  providerRoomId: z.string().trim().max(160).optional()
});

export const callIdInputSchema = z.object({
  callId: z.string().uuid()
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
  ownerType: z.enum(["post", "comment", "message", "note", "profile"]),
  ownerId: z.string().trim().min(1).max(200).optional()
});

export const confirmAttachmentInputSchema = z.object({
  attachmentId: z.string().uuid(),
  byteSize: z.number().int().positive().optional(),
  metadata: attachmentMetadataSchema.optional()
});

export const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(160),
  limit: z.number().int().positive().max(50).default(12)
});

export const sendMessageInputSchema = z.object({
  conversationId: z.string().uuid().optional(),
  recipientHandle: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().min(1).max(8000)
});

export const saveNoteBlockInputSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  noteId: z.string().uuid().optional(),
  blockId: z.string().uuid().optional(),
  expectedNoteRevision: z.number().int().positive().optional(),
  expectedBlockRevision: z.number().int().positive().optional(),
  body: z.string().max(50000),
  visibility: z.enum(["private", "community", "public"]).default("private")
});

export const publishNoteInputSchema = z.object({
  noteId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  visibility: z.enum(["private", "community", "public"]).default("public")
});

export const assistantMessageInputSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(12000),
  contextType: z.enum(["general", "room", "post", "community", "note"]).default("general"),
  contextId: z.string().trim().min(1).max(240).optional()
});

export const markNotificationInputSchema = z.object({
  notificationId: z.string().uuid()
});

export const profileFollowSchema = z.object({
  followerHandle: z.string(),
  followingHandle: z.string(),
  status: z.union([followStatusSchema, z.literal("none")]),
  revision: z.number().int().positive().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
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
export type ToggleActionContract = z.infer<typeof toggleActionSchema>;
export type ActionSubjectTypeContract = z.infer<typeof actionSubjectTypeSchema>;
export type ResourceTypeContract = z.infer<typeof resourceTypeSchema>;
export type ResourceVisibilityContract = z.infer<typeof resourceVisibilitySchema>;
export type ResourceLifecycleContract = z.infer<typeof resourceLifecycleSchema>;
export type ResourceReferenceContract = z.infer<typeof resourceReferenceSchema>;
export type VersionedDocumentContract = z.infer<typeof versionedDocumentSchema>;
export type ResearchProfileContract = z.infer<typeof researchProfileSchema>;
export type CreateProfileInputContract = z.infer<typeof createProfileInputSchema>;
export type InquiryItemContract = z.infer<typeof inquiryItemSchema>;
export type InquiryAttachmentContract = z.infer<typeof inquiryAttachmentSchema>;
export type ResearchCommunityContract = z.infer<typeof researchCommunitySchema>;
export type CreatePostInputContract = z.infer<typeof createPostInputSchema>;
export type CreateCommentInputContract = z.infer<typeof createCommentInputSchema>;
export type UpdateCommentInputContract = z.infer<typeof updateCommentInputSchema>;
export type PostActionInputContract = z.infer<typeof postActionInputSchema>;
export type CanonicalActionActivityContract = z.infer<typeof canonicalActionActivitySchema>;
export type ProfileActivityQueryContract = z.infer<typeof profileActivityQuerySchema>;
export type ProfileActivityResponseContract = z.infer<typeof profileActivityResponseSchema>;
export type AttachmentStatusContract = z.infer<typeof attachmentStatusSchema>;
export type AttachmentKindContract = z.infer<typeof attachmentKindSchema>;
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
