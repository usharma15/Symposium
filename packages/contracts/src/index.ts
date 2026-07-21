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
export const postTypeSchema = z.enum(["paper", "thought", "proposal", "opportunity"]);
export const postActionSchema = z.enum(["signal", "save", "fork", "read"]);
export const toggleActionSchema = z.enum(["signal", "save", "fork"]);
export const actionSubjectTypeSchema = z.enum(["post", "comment"]);
export const communityVisibilitySchema = z.enum(["public", "private"]);
export const communityMembershipStatusSchema = z.enum(["none", "requested", "invited", "active"]);
export const communityContentAccessSchema = z.enum(["full", "activity-only", "citation-only"]);
export const communitySummaryMaxLength = 120;
export const callStatusSchema = z.enum(["quiet", "voice live", "video live"]);
export const liveCallStatusSchema = z.enum(["scheduled", "live", "ended", "cancelled"]);
export const liveCallKindSchema = z.enum(["voice", "video"]);
export const patronageProposalStatusSchema = z.enum(["open", "funded", "closed"]);
export const patronageCurrencySchema = z.enum(["USD", "EUR", "GBP", "CAD", "AUD"]);
export const patronageContributionStatusSchema = z.enum(["pending", "confirmed", "refunded", "failed"]);
export const patronageProposalInputSchema = z.object({
  status: patronageProposalStatusSchema.default("open"),
  currency: patronageCurrencySchema.default("USD"),
  goalMinorUnits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  deadline: z.string().date().nullable().default(null)
});
export const patronageSupporterSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  amountMinorUnits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  anonymous: z.boolean().default(false)
});
export const patronageProposalSchema = patronageProposalInputSchema.extend({
  raisedMinorUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  supporterCount: z.number().int().nonnegative().default(0),
  topSupporters: z.array(patronageSupporterSchema).max(10).default([])
});
export const patronageContributionSchema = z.object({
  id: z.string().uuid(),
  postId: z.string().trim().min(1).max(240),
  contributorHandle: z.string().trim().min(1).max(80).nullable().default(null),
  displayName: z.string().trim().min(1).max(160),
  amountMinorUnits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: patronageCurrencySchema,
  anonymous: z.boolean().default(false),
  provider: z.string().trim().min(1).max(80),
  status: patronageContributionStatusSchema,
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable().default(null)
});
export const attachmentStatusSchema = z.enum(["pending", "uploaded", "previewed", "failed"]);
export const attachmentKindSchema = z.enum([
  "image",
  "video",
  "pdf",
  "text",
  "document",
  "code",
  "spreadsheet",
  "presentation"
]);
const codeAttachmentExtensions = new Set([
  ".asm", ".bash", ".c", ".cc", ".conf", ".cpp", ".cxx", ".cs", ".css", ".dart", ".erl", ".ex", ".exs",
  ".fish", ".fs", ".fsx", ".go", ".gradle", ".graphql", ".groovy", ".h", ".hpp", ".hs", ".html", ".ini",
  ".ipynb", ".java", ".js", ".jsx", ".json", ".kt", ".kts", ".lua", ".m", ".mm", ".php", ".pl", ".ps1",
  ".py", ".r", ".rb", ".rs", ".s", ".scala", ".sh", ".sql", ".swift", ".tex", ".toml", ".ts", ".tsx",
  ".vb", ".vue", ".xml", ".yaml", ".yml", ".zsh"
]);
const spreadsheetAttachmentExtensions = new Set([".csv", ".xls", ".xlsx", ".ods"]);
const presentationAttachmentExtensions = new Set([".ppt", ".pptx", ".odp"]);

export const attachmentKindForFile = (contentType: string, fileName = ""): z.infer<typeof attachmentKindSchema> => {
  const normalized = contentType.toLowerCase();
  const extension = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (presentationAttachmentExtensions.has(extension) || normalized.includes("presentation") || normalized === "application/vnd.ms-powerpoint") return "presentation";
  if (spreadsheetAttachmentExtensions.has(extension) || normalized.includes("spreadsheet") || normalized === "application/vnd.ms-excel" || normalized === "text/csv") return "spreadsheet";
  if (codeAttachmentExtensions.has(extension)) return "code";
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized === "application/pdf") return "pdf";
  if (normalized.startsWith("text/") || normalized === "application/json") return "text";
  return "document";
};
export const followStatusSchema = z.enum(["active", "muted", "blocked"]);
export const opportunityStatusSchema = z.enum(["open", "closed", "draft"]);
export const opportunityPostStatusSchema = z.enum(["open", "closed"]);
export const opportunityKindSchema = z.enum([
  "job",
  "bounty",
  "collaboration",
  "grant",
  "internship",
  "fellowship",
  "residency",
  "open_call",
  "open_problem",
  "event"
]);
export const opportunityPostInputSchema = z.object({
  kind: opportunityKindSchema.default("collaboration"),
  status: opportunityPostStatusSchema.default("open"),
  location: z.string().trim().min(1).max(160).nullable().default(null),
  compensation: z.string().trim().min(1).max(160).nullable().default(null),
  deadline: z.string().date().nullable().default(null)
});
export const opportunityPostSchema = opportunityPostInputSchema.extend({
  applicationCount: z.number().int().nonnegative().default(0)
});
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
  "proposal",
  "contribution",
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

export const documentMarkSchema = z.enum(["bold", "italic", "underline", "code", "strikethrough"]);
export const documentFontSchema = z.enum(["system", "serif", "humanist", "mono"]);
export const documentTextSizeSchema = z.enum(["small", "normal", "large", "lead"]);
export const documentTextColorSchema = z.enum(["default", "muted", "blue", "crimson", "forest", "gold"]);
const textMarksSchema = z.array(documentMarkSchema).max(5).default([]);
export const documentTextSchema = z.object({
  text: z.string().max(100000),
  marks: textMarksSchema.optional(),
  link: safeExternalUrlSchema.optional(),
  mentionHandle: z.string().trim().min(2).max(80).optional(),
  font: documentFontSchema.optional(),
  size: documentTextSizeSchema.optional(),
  color: documentTextColorSchema.optional()
});

const documentNodeIdSchema = z.string().trim().min(1).max(120);
const documentTextContentSchema = z.array(documentTextSchema).max(5000).default([]);
export const postToneSchema = z.enum(["thought", "paper", "patronage", "opportunity"]);
export const documentSourceSnapshotSchema = z.object({
  kind: z.enum(["post", "comment", "attachment"]),
  sourceId: z.string().trim().min(1).max(240),
  sourcePostId: z.string().trim().min(1).max(240),
  sourceCommentId: z.string().trim().min(1).max(240).optional(),
  sourceRevision: z.number().int().positive().optional(),
  author: z.string().trim().max(200).optional(),
  authorHandle: z.string().trim().max(80).optional(),
  title: z.string().trim().max(300).optional(),
  body: z.string().max(4000).optional(),
  postTone: postToneSchema.optional(),
  createdAt: z.string().max(80).optional(),
  canonicalPath: z.string().trim().startsWith("/").max(1000),
  attachment: z.object({
    id: z.string().trim().min(1).max(240),
    fileName: z.string().trim().min(1).max(500),
    contentType: z.string().trim().min(1).max(200),
    kind: attachmentKindSchema,
    byteSize: z.number().int().nonnegative().max(50 * 1024 * 1024)
  }).optional()
});
export const documentCitationLocatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    startBlockId: documentNodeIdSchema.optional(),
    endBlockId: documentNodeIdSchema.optional(),
    startOffset: z.number().int().nonnegative().max(100000).optional(),
    endOffset: z.number().int().nonnegative().max(100000).optional()
  }),
  z.object({ kind: z.literal("whole") }),
  z.object({
    kind: z.literal("image-region"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1)
  }),
  z.object({ kind: z.literal("pdf-text"), page: z.number().int().positive().max(100000), excerpt: z.string().max(4000) }),
  z.object({ kind: z.literal("spreadsheet-range"), sheet: z.string().max(200), range: z.string().max(100) }),
  z.object({ kind: z.literal("presentation-slide"), slide: z.number().int().positive().max(100000) })
]);
const drawingPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  pressure: z.number().min(0).max(1).optional()
});
export const documentDrawingSchema = z.object({
  version: z.literal(1),
  width: z.number().int().min(240).max(2400).default(960),
  height: z.number().int().min(160).max(1600).default(540),
  strokes: z.array(z.object({
    color: z.enum(["ink", "blue", "crimson", "forest", "gold"]).default("ink"),
    width: z.number().min(1).max(32).default(4),
    points: z.array(drawingPointSchema).min(1).max(5000)
  })).max(500)
});
export const documentNodeSchema = z.discriminatedUnion("type", [
  z.object({
    id: documentNodeIdSchema,
    type: z.literal("paragraph"),
    content: documentTextContentSchema,
    align: z.enum(["left", "center", "right"]).default("left"),
    indent: z.number().int().min(0).max(8).default(0)
  }),
  z.object({
    id: documentNodeIdSchema,
    type: z.literal("heading"),
    level: z.number().int().min(1).max(4),
    content: documentTextContentSchema,
    align: z.enum(["left", "center", "right"]).default("left")
  }),
  z.object({
    id: documentNodeIdSchema,
    type: z.literal("list"),
    style: z.enum(["bullet", "dash", "decimal", "lower-alpha", "upper-alpha"]).default("bullet"),
    depth: z.number().int().min(0).max(8).default(0),
    items: z.array(documentTextContentSchema).min(1).max(200)
  }),
  z.object({ id: documentNodeIdSchema, type: z.literal("code"), language: z.string().max(80).optional(), code: z.string().max(100000) }),
  z.object({ id: documentNodeIdSchema, type: z.literal("drawing"), drawing: documentDrawingSchema, caption: z.string().max(1000).optional() }),
  z.object({
    id: documentNodeIdSchema,
    type: z.literal("equation"),
    source: z.string().trim().min(1).max(10000),
    display: z.boolean().default(true),
    label: z.string().trim().max(120).optional()
  }),
  z.object({
    id: documentNodeIdSchema,
    type: z.literal("attachment"),
    attachmentId: z.string().min(1),
    placement: z.literal("inline").default("inline"),
    caption: z.string().max(1000).optional()
  }),
  z.object({ id: documentNodeIdSchema, type: z.literal("quote"), content: documentTextContentSchema, source: resourceReferenceSchema.optional() }),
  z.object({ id: documentNodeIdSchema, type: z.literal("reference"), resource: resourceReferenceSchema, source: documentSourceSnapshotSchema.optional() }),
  z.object({
    id: documentNodeIdSchema,
    type: z.literal("citation"),
    label: z.string().max(4000),
    href: safeExternalUrlSchema.optional(),
    excerpt: z.string().max(4000).optional(),
    source: documentSourceSnapshotSchema.optional(),
    locator: documentCitationLocatorSchema.optional()
  })
]);

export const versionedDocumentSchema = z.object({
  version: z.literal(1),
  nodes: z.array(documentNodeSchema).min(1).max(2000),
  settings: z.object({
    width: z.enum(["standard", "wide"]).default("standard"),
    margin: z.enum(["compact", "normal", "generous"]).default("normal")
  }).optional()
});

export const workspaceDocumentKindSchema = z.enum([
  "note",
  "paper",
  "thought",
  "comment",
  "reply",
  "quick"
]);
export const workspacePublicationTargetSchema = z.enum([
  "undecided",
  "paper",
  "thought",
  "proposal",
  "opportunity",
  "comment",
  "reply"
]);
export const workspaceAccessRoleSchema = z.enum(["viewer", "commenter", "editor", "publisher", "owner"]);
export const workspaceGrantRoleSchema = z.enum(["viewer", "commenter", "editor", "publisher"]);
export const workspaceAccessResourceSchema = z.enum(["document", "notebook"]);
export const workspaceLifecycleSchema = z.enum(["draft", "published", "archived"]);

export const workspaceAccessRoleRank: Record<z.infer<typeof workspaceAccessRoleSchema>, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  publisher: 4,
  owner: 5
};

export const workspaceDocumentSupportsCollaborativeEditing = (
  kind: z.infer<typeof workspaceDocumentKindSchema>
) => kind === "note" || kind === "paper";

export const workspaceGrantCeiling = (
  actorRole: z.infer<typeof workspaceAccessRoleSchema>,
  kind?: z.infer<typeof workspaceDocumentKindSchema>
): z.infer<typeof workspaceGrantRoleSchema> | null => {
  if (actorRole === "owner") {
    return kind && !workspaceDocumentSupportsCollaborativeEditing(kind) ? "commenter" : "publisher";
  }
  if (kind && !workspaceDocumentSupportsCollaborativeEditing(kind)) return null;
  if (actorRole === "publisher") return "publisher";
  if (actorRole === "editor") return "editor";
  return null;
};

export const workspaceRoleWithinCeiling = (
  role: z.infer<typeof workspaceGrantRoleSchema>,
  ceiling: z.infer<typeof workspaceGrantRoleSchema> | null
) => Boolean(ceiling && workspaceAccessRoleRank[role] <= workspaceAccessRoleRank[ceiling]);

export const documentFitsReducedEditor = (document: z.infer<typeof versionedDocumentSchema>) =>
  document.nodes.every((node) => {
    if (!["paragraph", "heading", "equation", "attachment", "quote", "reference", "citation"].includes(node.type)) return false;
    if (node.type !== "paragraph" && node.type !== "heading" && node.type !== "quote") return true;
    if (node.type === "heading" && (node.level < 2 || node.level > 3)) return false;
    return node.content.every((run) => !run.font && !run.size && !run.color && !run.marks?.includes("code") && !run.marks?.includes("strikethrough"));
  });

export const documentFitsScribbleEditor = (document: z.infer<typeof versionedDocumentSchema>) =>
  document.nodes.every((node) => {
    if (!["paragraph", "equation", "code", "drawing", "reference", "citation"].includes(node.type)) return false;
    if (node.type !== "paragraph") return true;
    return node.content.every((run) =>
      !run.font && !run.size && !run.color && !run.link && !run.mentionHandle
      && (run.marks ?? []).every((mark) => mark === "bold")
    );
  });

export const documentPlainTextProjection = (document: z.infer<typeof versionedDocumentSchema>) =>
  document.nodes
    .map((node) => {
      const runs = (content: z.infer<typeof documentTextContentSchema>) =>
        content.map((run) => run.text).join("");
      if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") return runs(node.content);
      if (node.type === "list") return node.items.map(runs).join("\n");
      if (node.type === "code") return node.code;
      if (node.type === "drawing") return node.caption ?? "Drawing";
      if (node.type === "equation") return node.source;
      if (node.type === "citation") return node.label;
      if (node.type === "reference") return node.resource.label ?? "";
      return node.caption ?? "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();

const validateDocumentAttachmentReferences = (
  document: z.infer<typeof versionedDocumentSchema> | undefined,
  attachmentIds: string[] | undefined,
  context: z.core.$RefinementCtx<unknown>
) => {
  if (!document) return;
  const inlineIds = document.nodes.filter((node) => node.type === "attachment").map((node) => node.attachmentId);
  if (new Set(inlineIds).size !== inlineIds.length) {
    context.addIssue({ code: "custom", path: ["document"], message: "Each inline attachment may appear only once." });
  }
  const available = new Set(attachmentIds ?? []);
  if (inlineIds.some((attachmentId) => !available.has(attachmentId))) {
    context.addIssue({ code: "custom", path: ["document"], message: "Inline attachments must be included in the content attachment set." });
  }
};

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
  actorKind: z.enum(["person", "historical_simulation", "editorial"]).optional(),
  era: z.string().max(160).optional(),
  lifeDates: z.string().max(120).optional(),
  disclosure: z.string().max(600).optional(),
  sourceUrl: safeExternalUrlSchema.optional(),
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

export const opportunityApplicationCommentSchema = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  authorHandle: z.string().trim().min(1).max(80),
  authorName: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(8000),
  createdAt: z.string().datetime()
});

export const opportunityApplicationSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  postId: z.string().trim().min(1).max(240),
  applicantHandle: z.string().trim().min(1).max(80),
  applicantName: z.string().trim().min(1).max(160),
  applicantAvatarUrl: safeExternalUrlSchema.optional(),
  applicantAffiliation: z.string().max(240),
  applicantEmail: z.string().email().optional(),
  statement: z.string().trim().min(1).max(20000),
  shortlisted: z.boolean(),
  attachments: z.array(inquiryAttachmentSchema).max(20).default([]),
  comments: z.array(opportunityApplicationCommentSchema).max(1000).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const createOpportunityApplicationInputSchema = z.object({
  postId: z.string().trim().min(1).max(240),
  statement: z.string().trim().min(1).max(20000),
  attachmentIds: z.array(z.string().uuid()).max(20).default([]),
  actorHandle: z.string().trim().min(1).max(80).optional()
});

export const updateOpportunityApplicationInputSchema = z.object({
  shortlisted: z.boolean(),
  expectedRevision: z.number().int().positive(),
  actorHandle: z.string().trim().min(1).max(80).optional()
});

export const createOpportunityApplicationCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  actorHandle: z.string().trim().min(1).max(80).optional()
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
  postType: postTypeSchema.optional(),
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
  document?: VersionedDocumentContract;
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
    document: versionedDocumentSchema.optional(),
    attachments: z.array(inquiryAttachmentSchema).max(100).optional(),
    quote: contentQuoteSchema.optional(),
    replies: z.array(inquiryCommentSchema).optional()
  })
);

export const inquiryItemSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive().optional(),
  kind: contentKindSchema,
  postType: postTypeSchema.optional(),
  room: postRoomSchema,
  communityId: z.string().trim().min(1).max(120).optional(),
  communityAccess: communityContentAccessSchema.optional(),
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
  document: versionedDocumentSchema.optional(),
  tags: z.array(z.string()),
  signals: z.array(inquirySignalSchema),
  claims: z.array(z.string()),
  objections: z.array(z.string()),
  evidence: z.array(z.string()),
  tests: z.array(z.string()),
  forks: z.array(z.string()),
  commentCount: z.number().int().nonnegative().optional(),
  detailLoaded: z.boolean().optional(),
  comments: z.array(inquiryCommentSchema),
  attachments: z.array(inquiryAttachmentSchema).max(100).optional(),
  quote: contentQuoteSchema.optional(),
  patronage: patronageProposalSchema.optional(),
  opportunity: opportunityPostSchema.optional(),
  saved: z.boolean().optional(),
  savedBy: z.array(z.string()).optional(),
  signaledBy: z.array(z.string()).optional(),
  forkedBy: z.array(z.string()).optional()
});

export const researchCommunitySchema = z.object({
  id: z.string(),
  revision: z.number().int().positive().optional(),
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
  callStatus: callStatusSchema,
  memberCount: z.number().int().nonnegative().optional(),
  monthlyActive: z.number().int().nonnegative().optional(),
  membershipStatus: communityMembershipStatusSchema.optional(),
  viewerRole: z.enum(["owner", "moderator", "member"]).optional(),
  ownerHandle: z.string().optional(),
  lastAccessedAt: z.string().datetime().optional(),
  moderatorHandles: z.array(z.string()).optional(),
  guidelines: z.string().max(12000).optional(),
  announcements: z.array(z.object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    createdAt: z.string().optional(),
    authorHandle: z.string().optional(),
    updatedAt: z.string().optional(),
    updatedByHandle: z.string().optional()
  })).optional()
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
  document: versionedDocumentSchema.optional(),
  kind: contentKindSchema,
  postType: postTypeSchema,
  room: postRoomSchema,
  communityId: z.string().trim().min(1).max(120).optional(),
  authorHandle: z.string().optional(),
  attachmentIds: z.array(postAttachmentIdSchema).max(100).optional(),
  quoteSource: contentQuoteSourceSchema.optional(),
  patronage: patronageProposalInputSchema.optional(),
  opportunity: opportunityPostInputSchema.optional(),
  attachments: z.array(postAttachmentInputSchema).max(10).default([])
}).superRefine((input, context) => {
  validateDocumentAttachmentReferences(input.document, input.attachmentIds, context);
  const expectedPostType = input.patronage
    ? "proposal"
    : input.opportunity
      ? "opportunity"
      : input.kind === "paper"
        ? "paper"
        : input.kind === "thought" || input.kind === "note"
          ? "thought"
          : null;
  if (expectedPostType !== input.postType) {
    context.addIssue({
      code: "custom",
      path: ["postType"],
      message: "The public post type must describe the publication itself, independently of its editor grade."
    });
  }
  if (input.communityId && input.postType === "paper" && input.room !== "library") {
    context.addIssue({
      code: "custom",
      path: ["room"],
      message: "Community papers publish canonically in the Library."
    });
  }
  if (input.kind !== "paper" && input.document && !documentFitsReducedEditor(input.document)) {
    context.addIssue({ code: "custom", path: ["document"], message: "Thoughts use the reduced editor formatting set." });
  }
  if (input.patronage && (input.kind !== "paper" || input.room !== "funding")) {
    context.addIssue({ code: "custom", path: ["patronage"], message: "Patronage proposals publish as paper-grade posts in the Patronage Hall." });
  }
  if (input.room === "funding" && !input.patronage) {
    context.addIssue({ code: "custom", path: ["patronage"], message: "Patronage Hall posts require proposal funding details." });
  }
  if (input.opportunity && (input.kind !== "thought" || input.room !== "opportunities")) {
    context.addIssue({ code: "custom", path: ["opportunity"], message: "Opportunities publish as thought-grade posts in Opportunities." });
  }
  if (input.room === "opportunities" && !input.opportunity) {
    context.addIssue({ code: "custom", path: ["opportunity"], message: "Opportunity posts require application metadata." });
  }
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
  document: versionedDocumentSchema.optional(),
  expectedEditedAt: z.string().datetime().nullable().optional(),
  attachmentIds: z.array(postAttachmentIdSchema).max(100).optional(),
  quoteSource: contentQuoteSourceSchema.nullable().optional(),
  patronage: patronageProposalInputSchema.optional(),
  opportunity: opportunityPostInputSchema.optional(),
  actorHandle: z.string().optional()
}).superRefine((input, context) => {
  validateDocumentAttachmentReferences(input.document, input.attachmentIds, context);
  if ((input.attachmentIds !== undefined || input.quoteSource !== undefined || input.document !== undefined || input.patronage !== undefined || input.opportunity !== undefined) && input.expectedEditedAt === undefined) {
    context.addIssue({
      code: "custom",
      path: ["expectedEditedAt"],
      message: "Editing post attachments or its quote requires the content version that was loaded."
    });
  }
});

export const createCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  document: versionedDocumentSchema.optional(),
  stance: z.string().trim().min(1).default("Comment"),
  parentId: z.string().nullable().optional(),
  attachmentIds: z.array(postAttachmentIdSchema).max(100).optional(),
  quoteSource: contentQuoteSourceSchema.optional(),
  authorHandle: z.string().optional()
}).superRefine((input, context) => {
  validateDocumentAttachmentReferences(input.document, input.attachmentIds, context);
  if (input.document && !documentFitsReducedEditor(input.document)) {
    context.addIssue({ code: "custom", path: ["document"], message: "Comments use the reduced editor formatting set." });
  }
});

export const updateCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  document: versionedDocumentSchema.optional(),
  expectedEditedAt: z.string().datetime().nullable().optional(),
  attachmentIds: z.array(postAttachmentIdSchema).max(100).optional(),
  quoteSource: contentQuoteSourceSchema.nullable().optional(),
  actorHandle: z.string().optional()
}).superRefine((input, context) => {
  validateDocumentAttachmentReferences(input.document, input.attachmentIds, context);
  if (input.document && !documentFitsReducedEditor(input.document)) {
    context.addIssue({ code: "custom", path: ["document"], message: "Comments use the reduced editor formatting set." });
  }
  if ((input.attachmentIds !== undefined || input.quoteSource !== undefined || input.document !== undefined) && input.expectedEditedAt === undefined) {
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

export const profileAuthoredCommentActivitySchema = z.object({
  commentId: z.string().min(1),
  postId: z.string().min(1),
  occurredAt: z.string().datetime()
});

export const profileActivityQuerySchema = z.object({
  cursor: z.string().max(300).optional(),
  commentsCursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
  actions: z.preprocess(
    (value) => typeof value === "string" ? value.split(",").filter(Boolean) : value,
    z.array(toggleActionSchema).max(3).optional()
  ),
  includeComments: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean().default(true)
  ),
  includeSummary: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean().default(true)
  )
});

export const profileActivityCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  papers: z.number().int().nonnegative(),
  thoughts: z.number().int().nonnegative(),
  proposals: z.number().int().nonnegative(),
  opportunities: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  reshares: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  saved: z.number().int().nonnegative()
});

export const profileActivityResponseSchema = z.object({
  entries: z.array(canonicalActionActivitySchema),
  nextCursor: z.string().nullable(),
  authoredComments: z.array(profileAuthoredCommentActivitySchema).optional(),
  commentsNextCursor: z.string().nullable().optional(),
  hiddenCommunityCounts: profileActivityCountsSchema.optional(),
  totals: profileActivityCountsSchema.optional(),
  items: z.array(inquiryItemSchema).max(100).optional(),
  profiles: z.record(z.string(), researchProfileSchema).optional()
});

export const joinCommunityInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120)
});

export const createCommunityInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  field: z.string().trim().min(2).max(180),
  summary: z.string().trim().min(2).max(communitySummaryMaxLength),
  visibility: communityVisibilitySchema,
  guidelines: z.string().trim().max(12000).optional(),
  moderatorHandles: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  keywords: z.array(z.string().trim().min(1).max(50)).max(20).default([])
});

export const updateCommunityVisibilityInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120),
  visibility: communityVisibilitySchema,
  expectedRevision: z.number().int().positive()
});

export const updateCommunitySettingsInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(2).max(120).optional(),
  summary: z.string().trim().min(2).max(communitySummaryMaxLength).optional(),
  guidelines: z.string().trim().max(12000).optional(),
  visibility: communityVisibilitySchema.optional(),
  expectedRevision: z.number().int().positive()
}).refine(
  (input) => input.name !== undefined || input.summary !== undefined || input.guidelines !== undefined || input.visibility !== undefined,
  { message: "Choose at least one community setting to update." }
);

export const updateCommunityMemberInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120),
  memberHandle: z.string().trim().min(1).max(80),
  role: z.enum(["moderator", "member"]),
  expectedRevision: z.number().int().positive()
});

export const removeCommunityMemberInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120),
  memberHandle: z.string().trim().min(1).max(80),
  expectedRevision: z.number().int().positive()
});

export const resolveCommunityRequestInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120),
  memberHandle: z.string().trim().min(1).max(80),
  decision: z.enum(["approve", "decline"]),
  expectedRevision: z.number().int().positive()
});

export const createCommunityAnnouncementInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().min(1).max(1600),
  expectedRevision: z.number().int().positive()
});

export const updateCommunityAnnouncementInputSchema = createCommunityAnnouncementInputSchema.extend({
  announcementId: z.string().trim().min(1).max(120)
});

export const deleteCommunityAnnouncementInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120),
  announcementId: z.string().trim().min(1).max(120),
  expectedRevision: z.number().int().positive()
});

export const communityMembershipActionInputSchema = z.object({
  communityId: z.string().trim().min(1).max(120),
  action: z.enum(["join", "leave", "access"])
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
  ownerType: z.enum(["post", "comment", "message", "note", "note_comment", "opportunity_application", "profile"]),
  ownerId: z.string().trim().min(1).max(200).optional()
});

export const confirmAttachmentInputSchema = z.object({
  attachmentId: z.string().uuid(),
  byteSize: z.number().int().positive().optional(),
  metadata: attachmentMetadataSchema.optional()
});

export const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(160),
  limit: z.number().int().positive().max(50).default(12),
  cursor: z.string().trim().max(500).optional(),
  room: postRoomSchema.optional(),
  postTypes: z.array(postTypeSchema).min(1).max(4).optional(),
  communityId: z.string().trim().min(1).max(120).optional()
});

export const postPageQuerySchema = z.object({
  cursor: z.string().trim().max(500).optional(),
  limit: z.number().int().positive().max(50).default(24),
  room: postRoomSchema.optional(),
  postType: postTypeSchema.optional(),
  postTypes: z.array(postTypeSchema).min(1).max(4).optional(),
  communityId: z.string().trim().min(1).max(120).optional(),
  authorHandle: z.string().trim().min(1).max(80).optional(),
  saved: z.boolean().optional(),
  following: z.boolean().optional(),
  ids: z.array(z.string().trim().min(1).max(240)).max(50).optional(),
  commentIds: z.array(z.string().trim().min(1).max(240)).max(50).optional()
});

export const postPageResponseSchema = z.object({
  items: z.array(inquiryItemSchema).max(50),
  profiles: z.record(z.string(), researchProfileSchema),
  nextCursor: z.string().nullable()
});

export const searchResponseSchema = z.object({
  posts: z.array(inquiryItemSchema).max(50),
  profiles: z.array(researchProfileSchema).max(50),
  communities: z.array(researchCommunitySchema).max(50),
  nextCursor: z.string().nullable().default(null)
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

const workspaceDocumentFieldsSchema = z.object({
  title: z.string().trim().min(1).max(240),
  body: z.string().max(100000),
  document: versionedDocumentSchema,
  kind: workspaceDocumentKindSchema,
  publicationTarget: workspacePublicationTargetSchema.default("undecided"),
  notebookId: z.string().uuid().nullable().default(null),
  targetId: z.string().trim().min(1).max(240).nullable().default(null),
  proposal: patronageProposalInputSchema.nullable().default(null),
  opportunity: opportunityPostInputSchema.nullable().default(null),
  attachmentIds: z.array(postAttachmentIdSchema).max(100).default([])
});

export const createWorkspaceDocumentInputSchema = workspaceDocumentFieldsSchema.superRefine((input, context) => {
  validateDocumentAttachmentReferences(input.document, input.attachmentIds, context);
  if (["thought", "comment", "reply"].includes(input.kind) && !documentFitsReducedEditor(input.document)) {
    context.addIssue({ code: "custom", path: ["document"], message: "This draft type uses the reduced editor formatting set." });
  }
  if (input.kind === "quick") {
    context.addIssue({ code: "custom", path: ["kind"], message: "Quick Notes are created by filing the active Scribble." });
  }
  if (input.publicationTarget === "proposal" && (!input.proposal || input.kind !== "paper")) {
    context.addIssue({ code: "custom", path: ["proposal"], message: "A Patronage Proposal uses a paper-grade draft with funding details." });
  }
  if (input.publicationTarget !== "proposal" && input.proposal) {
    context.addIssue({ code: "custom", path: ["proposal"], message: "Funding details belong only to Patronage Proposal drafts." });
  }
  if (input.publicationTarget === "opportunity" && (!input.opportunity || input.kind !== "thought")) {
    context.addIssue({ code: "custom", path: ["opportunity"], message: "An Opportunity uses a thought-grade draft with application metadata." });
  }
  if (input.publicationTarget !== "opportunity" && input.opportunity) {
    context.addIssue({ code: "custom", path: ["opportunity"], message: "Opportunity metadata belongs only to Opportunity drafts." });
  }
});

export const updateWorkspaceDocumentInputSchema = workspaceDocumentFieldsSchema.extend({
  expectedRevision: z.number().int().positive(),
  checkpoint: z.boolean().default(false)
}).superRefine((input, context) => {
  validateDocumentAttachmentReferences(input.document, input.attachmentIds, context);
  if (["thought", "comment", "reply"].includes(input.kind) && !documentFitsReducedEditor(input.document)) {
    context.addIssue({ code: "custom", path: ["document"], message: "This draft type uses the reduced editor formatting set." });
  }
  if (input.kind === "quick" && !documentFitsScribbleEditor(input.document)) {
    context.addIssue({ code: "custom", path: ["document"], message: "Quick Notes use the Scribble formatting set." });
  }
  if (input.publicationTarget === "proposal" && (!input.proposal || input.kind !== "paper")) {
    context.addIssue({ code: "custom", path: ["proposal"], message: "A Patronage Proposal uses a paper-grade draft with funding details." });
  }
  if (input.publicationTarget !== "proposal" && input.proposal) {
    context.addIssue({ code: "custom", path: ["proposal"], message: "Funding details belong only to Patronage Proposal drafts." });
  }
  if (input.publicationTarget === "opportunity" && (!input.opportunity || input.kind !== "thought")) {
    context.addIssue({ code: "custom", path: ["opportunity"], message: "An Opportunity uses a thought-grade draft with application metadata." });
  }
  if (input.publicationTarget !== "opportunity" && input.opportunity) {
    context.addIssue({ code: "custom", path: ["opportunity"], message: "Opportunity metadata belongs only to Opportunity drafts." });
  }
});

export const updateScribbleInputSchema = z.object({
  body: z.string().max(100000),
  document: versionedDocumentSchema,
  expectedRevision: z.number().int().positive()
}).superRefine((input, context) => {
  if (!documentFitsScribbleEditor(input.document)) {
    context.addIssue({ code: "custom", path: ["document"], message: "Scribble content uses the compact formatting set." });
  }
  if (input.body !== documentPlainTextProjection(input.document)) {
    context.addIssue({ code: "custom", path: ["body"], message: "Scribble plain text must match its structured document." });
  }
});

export const fileScribbleInputSchema = z.object({
  expectedRevision: z.number().int().positive(),
  notebookId: z.string().uuid().nullable().default(null),
  title: z.string().trim().min(1).max(240).optional()
});

export const discardScribbleInputSchema = z.object({
  expectedRevision: z.number().int().positive()
});

export const restoreScribbleInputSchema = z.object({
  discardedRevision: z.number().int().positive(),
  expectedRevision: z.number().int().positive()
});

export const createWorkspaceCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  document: versionedDocumentSchema.optional(),
  stance: z.string().trim().min(1).max(80).default("Comment"),
  parentId: z.string().uuid().nullable().optional(),
  attachmentIds: z.array(postAttachmentIdSchema).max(100).default([])
}).superRefine((input, context) => {
  validateDocumentAttachmentReferences(input.document, input.attachmentIds, context);
  if (input.document && !documentFitsReducedEditor(input.document)) {
    context.addIssue({ code: "custom", path: ["document"], message: "Draft comments use the reduced editor formatting set." });
  }
});

export const updateWorkspaceCommentInputSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  document: versionedDocumentSchema.optional(),
  expectedRevision: z.number().int().positive(),
  attachmentIds: z.array(postAttachmentIdSchema).max(100).default([])
}).superRefine((input, context) => {
  validateDocumentAttachmentReferences(input.document, input.attachmentIds, context);
  if (input.document && !documentFitsReducedEditor(input.document)) {
    context.addIssue({ code: "custom", path: ["document"], message: "Draft comments use the reduced editor formatting set." });
  }
});

export const deleteWorkspaceCommentInputSchema = z.object({
  expectedRevision: z.number().int().positive()
});

export const workspaceCommentActionInputSchema = z.object({
  action: z.enum(["signal", "save", "read"]),
  active: z.boolean().optional(),
  trigger: z.enum(["visibility", "click", "expand"]).optional(),
  surface: z.enum(["thread", "workspace"]).optional()
});

export const deleteWorkspaceDocumentInputSchema = z.object({
  expectedRevision: z.number().int().positive()
});

export const createWorkspaceNotebookInputSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

export const updateWorkspaceNotebookInputSchema = createWorkspaceNotebookInputSchema.extend({
  expectedRevision: z.number().int().positive()
});

export const deleteWorkspaceNotebookInputSchema = z.object({
  expectedRevision: z.number().int().positive()
});

export const createWorkspaceGrantInputSchema = z.object({
  granteeHandle: z.string().trim().min(1).max(80),
  role: workspaceGrantRoleSchema
});

export const updateWorkspaceGrantInputSchema = z.object({
  role: workspaceGrantRoleSchema,
  expectedRevision: z.number().int().positive()
});

export const deleteWorkspaceGrantInputSchema = z.object({
  expectedRevision: z.number().int().positive()
});

export const workspaceCollaboratorSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(160),
  limit: z.coerce.number().int().positive().max(24).default(12)
});

export const workspaceSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(160),
  kind: workspaceDocumentKindSchema.optional(),
  notebookId: z.string().uuid().nullable().optional(),
  limit: z.coerce.number().int().positive().max(50).default(24)
});

export const publishNoteInputSchema = z.object({
  noteId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  expectedRevision: z.number().int().positive().optional(),
  publicationTarget: z.enum(["paper", "thought", "proposal", "opportunity"]).optional(),
  visibility: z.enum(["private", "community", "public"]).default("public")
});

export const assistantSurfaceSchema = z.enum([
  "hall",
  "room",
  "post",
  "community",
  "profile",
  "workspace",
  "messages",
  "search",
  "opportunity",
  "attachment"
]);
export const assistantTranslationLanguageSchema = z.enum(["english", "french", "german", "spanish"]);
export const assistantRequestIntentSchema = z.enum(["answer", "translate"]);

export const assistantActionSourceSchema = z.object({
  surface: assistantSurfaceSchema,
  route: z.string().trim().startsWith("/").max(500),
  title: z.string().trim().min(1).max(300),
  entityType: z.string().trim().max(80).optional(),
  entityId: z.string().trim().max(240).optional()
});

export const assistantTranslationDraftSchema = z.object({
  translatedTitle: z.string().trim().min(1).max(300),
  translatedBody: z.string().trim().min(1).max(16000),
  quickNoteTitle: z.string().trim().min(1).max(240),
  quickNoteBody: z.string().trim().min(1).max(8000)
});

export const assistantTranslationSchema = assistantTranslationDraftSchema.extend({
  targetLanguage: assistantTranslationLanguageSchema,
  source: assistantActionSourceSchema
});

export const assistantQuickNoteDraftSchema = z.object({
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(8000)
});

export const assistantQuickNoteSchema = assistantQuickNoteDraftSchema.extend({
  source: assistantActionSourceSchema
});

export const assistantAnswerDraftSchema = z.object({
  body: z.string().trim().min(1).max(16000),
  shouldOfferQuickNote: z.boolean(),
  quickNoteTitle: z.string().trim().max(240),
  quickNoteBody: z.string().trim().max(8000)
}).superRefine((answer, context) => {
  if (answer.shouldOfferQuickNote && (!answer.quickNoteTitle || !answer.quickNoteBody)) {
    context.addIssue({ code: "custom", message: "A proposed Quick Note requires a title and body." });
  }
  if (!answer.shouldOfferQuickNote && (answer.quickNoteTitle || answer.quickNoteBody)) {
    context.addIssue({ code: "custom", message: "An ordinary answer cannot contain a hidden Quick Note draft." });
  }
});

export const assistantMessageInputSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(2000),
  intent: assistantRequestIntentSchema.default("answer"),
  targetLanguage: assistantTranslationLanguageSchema.optional(),
  contextType: z.enum(["general", "room", "post", "community", "note"]).default("general"),
  contextId: z.string().trim().min(1).max(240).optional(),
  context: z.object({
    surface: assistantSurfaceSchema,
    route: z.string().trim().max(500),
    title: z.string().trim().max(300),
    summary: z.string().trim().max(3000).default(""),
    content: z.string().trim().max(12000).default(""),
    entityType: z.string().trim().max(80).optional(),
    entityId: z.string().trim().max(240).optional(),
    selection: z.string().trim().max(4000).optional(),
    metadata: z.record(z.string().max(80), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).default({})
  })
}).superRefine((input, context) => {
  if (input.intent === "translate" && !input.targetLanguage) {
    context.addIssue({ code: "custom", path: ["targetLanguage"], message: "Choose a translation language." });
  }
});

const documentTranslationImageDataUrlSchema = z.string()
  .max(800_000)
  .regex(
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/,
    "Document translation images must be bounded JPEG, PNG, or WebP data URLs."
  );

export const documentTranslationSourcePageSchema = z.object({
  pageNumber: z.number().int().positive().max(1000),
  body: z.string().trim().max(12000).default(""),
  imageDataUrl: documentTranslationImageDataUrlSchema.optional()
}).superRefine((page, context) => {
  if (!page.body && !page.imageDataUrl) {
    context.addIssue({
      code: "custom",
      message: "A document page requires extracted text or a rendered page image."
    });
  }
});

export const documentTranslationInputSchema = z.object({
  attachmentId: z.string().trim().min(1).max(240),
  sourceTitle: z.string().trim().min(1).max(300),
  sourceKind: z.enum(["docx", "pdf"]),
  sourcePages: z.array(documentTranslationSourcePageSchema).length(1),
  sourceComplete: z.boolean(),
  languageInstruction: z.string().trim().min(1).max(120)
}).superRefine((input, context) => {
  const pageNumbers = input.sourcePages.map((page) => page.pageNumber);
  if (new Set(pageNumbers).size !== pageNumbers.length || pageNumbers.some((page, index) => index > 0 && page <= pageNumbers[index - 1]!)) {
    context.addIssue({ code: "custom", path: ["sourcePages"], message: "Document pages must be unique and ordered." });
  }
  if (input.sourcePages.reduce((total, page) => total + page.body.length, 0) > 50000) {
    context.addIssue({ code: "custom", path: ["sourcePages"], message: "Document translation is limited to 50,000 extracted characters." });
  }
});

export const documentTranslationPageSchema = z.object({
  pageNumber: z.number().int().positive().max(1000),
  body: z.string().trim().min(1).max(20000)
});

export const documentTranslationModelOutputSchema = z.object({
  targetLanguage: z.union([assistantTranslationLanguageSchema, z.literal("unsupported")]),
  targetLanguageLabel: z.string().trim().max(40),
  translatedTitle: z.string().trim().max(300),
  pages: z.array(documentTranslationPageSchema).max(1),
  message: z.string().trim().max(1000)
}).superRefine((output, context) => {
  if (output.targetLanguage === "unsupported" && output.pages.length) {
    context.addIssue({ code: "custom", path: ["pages"], message: "Unsupported languages cannot contain translated pages." });
  }
  if (output.targetLanguage !== "unsupported" && (!output.translatedTitle || !output.pages.length)) {
    context.addIssue({ code: "custom", message: "A supported translation requires its title and pages." });
  }
});

export const saveAssistantQuickNoteInputSchema = z.object({
  assistantMessageId: z.string().uuid(),
  conversationId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(8000),
  notebookId: z.string().uuid().nullable().default(null),
  targetLanguage: assistantTranslationLanguageSchema.optional(),
  source: assistantActionSourceSchema.optional()
});

export const assistantQuickNoteResultSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  notebookId: z.string().uuid().nullable(),
  notebookName: z.string().nullable(),
  href: z.string().startsWith("/workspace?")
});

export const conversationKindSchema = z.enum(["direct", "group"]);
export const conversationParticipantRoleSchema = z.enum(["owner", "admin", "member"]);
export const conversationParticipantStatusSchema = z.enum(["invited", "active", "removed"]);

export const conversationParticipantSchema = z.object({
  handle: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  avatarUrl: safeExternalUrlSchema.optional(),
  role: conversationParticipantRoleSchema,
  status: conversationParticipantStatusSchema
});

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  sequence: z.number().int().positive(),
  revision: z.number().int().positive(),
  senderHandle: z.string().trim().min(1).max(80).nullable(),
  body: z.string().max(8000),
  attachments: z.array(inquiryAttachmentSchema).max(10).default([]),
  starred: z.boolean().default(false),
  editedAt: z.string().datetime().nullable().default(null),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime()
});

export const conversationSummarySchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  kind: conversationKindSchema,
  title: z.string().trim().min(1).max(120).nullable(),
  role: conversationParticipantRoleSchema,
  status: conversationParticipantStatusSchema,
  muted: z.boolean(),
  pinned: z.boolean(),
  blockedByViewer: z.boolean().default(false),
  unreadCount: z.number().int().nonnegative(),
  participants: z.array(conversationParticipantSchema).max(64),
  lastMessage: messageSchema.nullable(),
  draftBody: z.string().max(8000),
  draftUpdatedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime()
});

export const conversationListQuerySchema = z.object({
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().positive().max(50).default(24)
});

export const conversationPageSchema = z.object({
  conversations: z.array(conversationSummarySchema).max(50),
  nextCursor: z.string().nullable()
});

export const messageUnreadCountSchema = z.object({
  unreadCount: z.number().int().nonnegative()
});

export const messageListQuerySchema = z.object({
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().positive().max(100).default(40)
});

export const messagePageSchema = z.object({
  conversation: conversationSummarySchema,
  messages: z.array(messageSchema).max(100),
  nextCursor: z.string().nullable()
});

export const sendMessageInputSchema = z.object({
  conversationId: z.string().uuid().optional(),
  recipientHandle: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().max(8000).default(""),
  attachmentIds: z.array(z.string().uuid()).max(10).default([])
}).superRefine((input, context) => {
  if (!input.conversationId && !input.recipientHandle) {
    context.addIssue({ code: "custom", message: "Choose a recipient or conversation." });
  }
  if (!input.body && !input.attachmentIds.length) {
    context.addIssue({ code: "custom", message: "Write a message or attach a file." });
  }
});

export const createGroupConversationInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  inviteeHandles: z.array(z.string().trim().min(1).max(80)).min(1).max(49)
});

// The wire name remains compatible with older deployed clients; the operation
// now adds these handles immediately and does not create pending invitations.
export const inviteConversationParticipantsInputSchema = z.object({
  handles: z.array(z.string().trim().min(1).max(80)).min(1).max(49)
});

export const updateConversationParticipantInputSchema = z.object({
  role: z.enum(["admin", "member"])
});

export const resolveConversationInviteInputSchema = z.object({
  action: z.enum(["accept", "decline"])
});

export const updateConversationPreferencesInputSchema = z.object({
  muted: z.boolean().optional(),
  pinned: z.boolean().optional()
}).refine((input) => input.muted !== undefined || input.pinned !== undefined, {
  message: "Choose a conversation preference to update."
});

export const saveConversationDraftInputSchema = z.object({
  body: z.string().max(8000)
});

export const markConversationReadInputSchema = z.object({
  sequence: z.number().int().nonnegative()
});

export const starMessageInputSchema = z.object({
  active: z.boolean()
});

export const editMessageInputSchema = z.object({
  body: z.string().trim().min(1).max(8000),
  expectedRevision: z.number().int().positive()
});

export const deleteMessageInputSchema = z.object({
  mode: z.enum(["self", "everyone"]),
  expectedRevision: z.number().int().positive().optional()
});

export const blockProfileInputSchema = z.object({
  targetHandle: z.string().trim().min(1).max(80),
  active: z.boolean()
});

export const conversationSearchInputSchema = z.object({
  query: z.string().trim().max(160).default(""),
  kind: attachmentKindSchema.or(z.literal("links")).optional(),
  limit: z.coerce.number().int().positive().max(50).default(24),
  cursor: z.string().trim().max(500).optional()
}).refine((input) => Boolean(input.query || input.kind), { message: "Enter a search term or choose a media type." });

export const notificationSchema = z.object({
  id: z.string().uuid(),
  kind: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  body: z.string().max(1000),
  href: z.string().max(500).nullable(),
  readAt: z.string().datetime().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime()
});

export const notificationListQuerySchema = z.object({
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().positive().max(50).default(30)
});

export const notificationPageSchema = z.object({
  notifications: z.array(notificationSchema).max(50),
  unreadCount: z.number().int().nonnegative(),
  nextCursor: z.string().nullable()
});

export const markNotificationInputSchema = z.object({
  notificationId: z.string().uuid().optional(),
  all: z.boolean().default(false)
}).refine((input) => input.all || Boolean(input.notificationId), {
  message: "Choose a notification or mark all notifications read."
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

export const communityMemberRoleSchema = z.enum(["owner", "moderator", "member"]);

export const communityMemberSchema = z.object({
  handle: z.string(),
  name: z.string(),
  avatarUrl: safeExternalUrlSchema.optional(),
  role: communityMemberRoleSchema,
  joinedAt: z.string().datetime()
});

export const communityMemberQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  role: z.enum(["all", "moderators"]).default("all"),
  status: z.enum(["active", "requested"]).default("active")
});

export const communityMemberPageSchema = z.object({
  members: z.array(communityMemberSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative()
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

export const assistantQuotaSchema = z.object({
  dailyLimit: z.number().int().positive(),
  remainingToday: z.number().int().nonnegative(),
  monthlyBudgetUsd: z.number().positive(),
  extremelyLimited: z.literal(true)
});

export const assistantQuotaStatusSchema = z.object({
  enabled: z.boolean(),
  providerConfigured: z.boolean(),
  model: z.string(),
  quota: assistantQuotaSchema
});

export const assistantResponseSchema = z.object({
  conversationId: z.string(),
  message: assistantMessageSchema,
  providerConfigured: z.boolean(),
  status: z.enum(["answered", "provider_not_configured", "disabled", "provider_error"]),
  model: z.string().optional(),
  quota: assistantQuotaSchema.optional(),
  translation: assistantTranslationSchema.optional(),
  quickNote: assistantQuickNoteSchema.optional()
});

export const documentTranslationResultSchema = z.object({
  status: z.enum(["translated", "unsupported_language", "provider_error", "disabled"]),
  attachmentId: z.string(),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  sourceComplete: z.boolean(),
  cached: z.boolean(),
  targetLanguage: assistantTranslationLanguageSchema.nullable(),
  targetLanguageLabel: z.string().max(40).nullable(),
  translatedTitle: z.string().max(300),
  pages: z.array(documentTranslationPageSchema).max(1),
  message: z.string().max(1000),
  model: z.string(),
  createdAt: z.string().datetime(),
  quota: assistantQuotaSchema
}).superRefine((result, context) => {
  if (result.status === "translated" && (!result.targetLanguage || !result.translatedTitle.trim() || !result.pages.length)) {
    context.addIssue({ code: "custom", message: "A completed document translation requires its language, title, and pages." });
  }
  if (result.status !== "translated" && result.pages.length) {
    context.addIssue({ code: "custom", path: ["pages"], message: "An incomplete document translation cannot contain translated pages." });
  }
});

export const bootstrapResponseSchema = z.object({
  profiles: z.record(z.string(), researchProfileSchema),
  items: z.array(inquiryItemSchema).max(50),
  communities: z.array(researchCommunitySchema).max(200).optional(),
  communityCalls: z.record(z.string(), z.array(communityCallSchema).max(5)).optional(),
  defaultProfile: researchProfileSchema,
  nextCursor: z.string().nullable().optional(),
  readModelVersion: z.literal(2).optional()
});

export type RoomIdContract = z.infer<typeof roomIdSchema>;
export type ContentKindContract = z.infer<typeof contentKindSchema>;
export type PostTypeContract = z.infer<typeof postTypeSchema>;
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
export type OpportunityPostInputContract = z.infer<typeof opportunityPostInputSchema>;
export type OpportunityPostContract = z.infer<typeof opportunityPostSchema>;
export type OpportunityKindContract = z.infer<typeof opportunityKindSchema>;
export type OpportunityApplicationContract = z.infer<typeof opportunityApplicationSchema>;
export type OpportunityApplicationCommentContract = z.infer<typeof opportunityApplicationCommentSchema>;
export type CreateOpportunityApplicationInputContract = z.infer<typeof createOpportunityApplicationInputSchema>;
export type UpdateOpportunityApplicationInputContract = z.infer<typeof updateOpportunityApplicationInputSchema>;
export type CreateOpportunityApplicationCommentInputContract = z.infer<typeof createOpportunityApplicationCommentInputSchema>;
export type PatronageProposalInputContract = z.infer<typeof patronageProposalInputSchema>;
export type PatronageProposalContract = z.infer<typeof patronageProposalSchema>;
export type PatronageSupporterContract = z.infer<typeof patronageSupporterSchema>;
export type PatronageContributionContract = z.infer<typeof patronageContributionSchema>;
export type InquiryAttachmentContract = z.infer<typeof inquiryAttachmentSchema>;
export type ResearchCommunityContract = z.infer<typeof researchCommunitySchema>;
export type CommunityMembershipStatusContract = z.infer<typeof communityMembershipStatusSchema>;
export type CommunityContentAccessContract = z.infer<typeof communityContentAccessSchema>;
export type CreateCommunityInputContract = z.infer<typeof createCommunityInputSchema>;
export type UpdateCommunityVisibilityInputContract = z.infer<typeof updateCommunityVisibilityInputSchema>;
export type UpdateCommunitySettingsInputContract = z.infer<typeof updateCommunitySettingsInputSchema>;
export type UpdateCommunityMemberInputContract = z.infer<typeof updateCommunityMemberInputSchema>;
export type RemoveCommunityMemberInputContract = z.infer<typeof removeCommunityMemberInputSchema>;
export type ResolveCommunityRequestInputContract = z.infer<typeof resolveCommunityRequestInputSchema>;
export type CreateCommunityAnnouncementInputContract = z.infer<typeof createCommunityAnnouncementInputSchema>;
export type UpdateCommunityAnnouncementInputContract = z.infer<typeof updateCommunityAnnouncementInputSchema>;
export type DeleteCommunityAnnouncementInputContract = z.infer<typeof deleteCommunityAnnouncementInputSchema>;
export type CommunityMembershipActionInputContract = z.infer<typeof communityMembershipActionInputSchema>;
export type CreatePostInputContract = z.infer<typeof createPostInputSchema>;
export type CreateCommentInputContract = z.infer<typeof createCommentInputSchema>;
export type UpdateCommentInputContract = z.infer<typeof updateCommentInputSchema>;
export type PostActionInputContract = z.infer<typeof postActionInputSchema>;
export type CanonicalActionActivityContract = z.infer<typeof canonicalActionActivitySchema>;
export type ProfileAuthoredCommentActivityContract = z.infer<typeof profileAuthoredCommentActivitySchema>;
export type ProfileActivityQueryContract = z.infer<typeof profileActivityQuerySchema>;
export type ProfileActivityCountsContract = z.infer<typeof profileActivityCountsSchema>;
export type ProfileActivityResponseContract = z.infer<typeof profileActivityResponseSchema>;
export type AttachmentStatusContract = z.infer<typeof attachmentStatusSchema>;
export type AttachmentKindContract = z.infer<typeof attachmentKindSchema>;
export type BootstrapResponseContract = z.infer<typeof bootstrapResponseSchema>;
export type PostPageQueryContract = z.infer<typeof postPageQuerySchema>;
export type PostPageResponseContract = z.infer<typeof postPageResponseSchema>;
export type SearchResponseContract = z.infer<typeof searchResponseSchema>;
export type ConversationKindContract = z.infer<typeof conversationKindSchema>;
export type ConversationParticipantRoleContract = z.infer<typeof conversationParticipantRoleSchema>;
export type ConversationParticipantStatusContract = z.infer<typeof conversationParticipantStatusSchema>;
export type ConversationParticipantContract = z.infer<typeof conversationParticipantSchema>;
export type MessageContract = z.infer<typeof messageSchema>;
export type ConversationSummaryContract = z.infer<typeof conversationSummarySchema>;
export type ConversationListQueryContract = z.infer<typeof conversationListQuerySchema>;
export type ConversationPageContract = z.infer<typeof conversationPageSchema>;
export type MessageUnreadCountContract = z.infer<typeof messageUnreadCountSchema>;
export type MessageListQueryContract = z.infer<typeof messageListQuerySchema>;
export type MessagePageContract = z.infer<typeof messagePageSchema>;
export type SendMessageInputContract = z.infer<typeof sendMessageInputSchema>;
export type CreateGroupConversationInputContract = z.infer<typeof createGroupConversationInputSchema>;
export type InviteConversationParticipantsInputContract = z.infer<typeof inviteConversationParticipantsInputSchema>;
export type UpdateConversationParticipantInputContract = z.infer<typeof updateConversationParticipantInputSchema>;
export type ResolveConversationInviteInputContract = z.infer<typeof resolveConversationInviteInputSchema>;
export type UpdateConversationPreferencesInputContract = z.infer<typeof updateConversationPreferencesInputSchema>;
export type SaveConversationDraftInputContract = z.infer<typeof saveConversationDraftInputSchema>;
export type MarkConversationReadInputContract = z.infer<typeof markConversationReadInputSchema>;
export type StarMessageInputContract = z.infer<typeof starMessageInputSchema>;
export type EditMessageInputContract = z.infer<typeof editMessageInputSchema>;
export type DeleteMessageInputContract = z.infer<typeof deleteMessageInputSchema>;
export type BlockProfileInputContract = z.infer<typeof blockProfileInputSchema>;
export type ConversationSearchInputContract = z.infer<typeof conversationSearchInputSchema>;
export type NotificationContract = z.infer<typeof notificationSchema>;
export type NotificationListQueryContract = z.infer<typeof notificationListQuerySchema>;
export type NotificationPageContract = z.infer<typeof notificationPageSchema>;
export type FollowProfileInputContract = z.infer<typeof followProfileInputSchema>;
export type ProfileFollowContract = z.infer<typeof profileFollowSchema>;
export type CommunityCallContract = z.infer<typeof communityCallSchema>;
export type CommunityMemberRoleContract = z.infer<typeof communityMemberRoleSchema>;
export type CommunityMemberContract = z.infer<typeof communityMemberSchema>;
export type CommunityMemberQueryContract = z.infer<typeof communityMemberQuerySchema>;
export type CommunityMemberPageContract = z.infer<typeof communityMemberPageSchema>;
export type CreateCommunityCallInputContract = z.infer<typeof createCommunityCallInputSchema>;
export type OpportunityContract = z.infer<typeof opportunitySchema>;
export type CreateOpportunityInputContract = z.infer<typeof createOpportunityInputSchema>;
export type WorkspaceDocumentKindContract = z.infer<typeof workspaceDocumentKindSchema>;
export type WorkspacePublicationTargetContract = z.infer<typeof workspacePublicationTargetSchema>;
export type WorkspaceAccessRoleContract = z.infer<typeof workspaceAccessRoleSchema>;
export type WorkspaceGrantRoleContract = z.infer<typeof workspaceGrantRoleSchema>;
export type WorkspaceAccessResourceContract = z.infer<typeof workspaceAccessResourceSchema>;
export type WorkspaceLifecycleContract = z.infer<typeof workspaceLifecycleSchema>;
export type CreateWorkspaceDocumentInputContract = z.infer<typeof createWorkspaceDocumentInputSchema>;
export type UpdateWorkspaceDocumentInputContract = z.infer<typeof updateWorkspaceDocumentInputSchema>;
export type CreateWorkspaceCommentInputContract = z.infer<typeof createWorkspaceCommentInputSchema>;
export type UpdateWorkspaceCommentInputContract = z.infer<typeof updateWorkspaceCommentInputSchema>;
export type DeleteWorkspaceCommentInputContract = z.infer<typeof deleteWorkspaceCommentInputSchema>;
export type WorkspaceCommentActionInputContract = z.infer<typeof workspaceCommentActionInputSchema>;
export type CreateWorkspaceNotebookInputContract = z.infer<typeof createWorkspaceNotebookInputSchema>;
export type UpdateWorkspaceNotebookInputContract = z.infer<typeof updateWorkspaceNotebookInputSchema>;
export type CreateWorkspaceGrantInputContract = z.infer<typeof createWorkspaceGrantInputSchema>;
export type UpdateWorkspaceGrantInputContract = z.infer<typeof updateWorkspaceGrantInputSchema>;
export type DeleteWorkspaceGrantInputContract = z.infer<typeof deleteWorkspaceGrantInputSchema>;
export type WorkspaceCollaboratorSearchInputContract = z.infer<typeof workspaceCollaboratorSearchInputSchema>;
export type WorkspaceSearchInputContract = z.infer<typeof workspaceSearchInputSchema>;
export type PostToneContract = z.infer<typeof postToneSchema>;
export type DocumentSourceSnapshotContract = z.infer<typeof documentSourceSnapshotSchema>;
export type DocumentCitationLocatorContract = z.infer<typeof documentCitationLocatorSchema>;
export type DocumentDrawingContract = z.infer<typeof documentDrawingSchema>;
export type UpdateScribbleInputContract = z.infer<typeof updateScribbleInputSchema>;
export type FileScribbleInputContract = z.infer<typeof fileScribbleInputSchema>;
export type DiscardScribbleInputContract = z.infer<typeof discardScribbleInputSchema>;
export type RestoreScribbleInputContract = z.infer<typeof restoreScribbleInputSchema>;
export type PublishNoteInputContract = z.infer<typeof publishNoteInputSchema>;
export type AssistantSurfaceContract = z.infer<typeof assistantSurfaceSchema>;
export type AssistantTranslationLanguageContract = z.infer<typeof assistantTranslationLanguageSchema>;
export type AssistantRequestIntentContract = z.infer<typeof assistantRequestIntentSchema>;
export type AssistantActionSourceContract = z.infer<typeof assistantActionSourceSchema>;
export type AssistantTranslationDraftContract = z.infer<typeof assistantTranslationDraftSchema>;
export type AssistantTranslationContract = z.infer<typeof assistantTranslationSchema>;
export type AssistantQuickNoteDraftContract = z.infer<typeof assistantQuickNoteDraftSchema>;
export type AssistantQuickNoteContract = z.infer<typeof assistantQuickNoteSchema>;
export type AssistantAnswerDraftContract = z.infer<typeof assistantAnswerDraftSchema>;
export type AssistantMessageInputContract = z.infer<typeof assistantMessageInputSchema>;
export type AssistantQuotaStatusContract = z.infer<typeof assistantQuotaStatusSchema>;
export type AssistantResponseContract = z.infer<typeof assistantResponseSchema>;
export type SaveAssistantQuickNoteInputContract = z.infer<typeof saveAssistantQuickNoteInputSchema>;
export type AssistantQuickNoteResultContract = z.infer<typeof assistantQuickNoteResultSchema>;
export type DocumentTranslationSourcePageContract = z.infer<typeof documentTranslationSourcePageSchema>;
export type DocumentTranslationInputContract = z.infer<typeof documentTranslationInputSchema>;
export type DocumentTranslationPageContract = z.infer<typeof documentTranslationPageSchema>;
export type DocumentTranslationModelOutputContract = z.infer<typeof documentTranslationModelOutputSchema>;
export type DocumentTranslationResultContract = z.infer<typeof documentTranslationResultSchema>;

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
  "communities.create",
  "communities.joinOrRequest",
  "communities.leave",
  "communities.recordAccess",
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
  "messages.getConversation",
  "messages.listMessages",
  "messages.send",
  "messages.createGroup",
  "messages.inviteParticipants",
  "messages.resolveInvite",
  "messages.updateParticipant",
  "messages.removeParticipant",
  "messages.updatePreferences",
  "messages.saveDraft",
  "messages.markRead",
  "messages.clear",
  "messages.deleteConversation",
  "messages.search",
  "messages.listStarred",
  "messages.star",
  "messages.edit",
  "messages.delete",
  "messages.blockProfile",
  "notes.getWorkspace",
  "notes.createDocument",
  "notes.updateDocument",
  "notes.deleteDocument",
  "notes.createNotebook",
  "notes.updateNotebook",
  "notes.deleteNotebook",
  "notes.searchWorkspace",
  "notes.saveBlock",
  "notes.publish",
  "assistant.ask"
] as const;

export type ProcedureNameContract = (typeof procedureNames)[number];
