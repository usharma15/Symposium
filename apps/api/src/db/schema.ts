import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import type {
  ContentKindContract,
  InquiryItemContract,
  ResearchCommunityContract,
  ResearchProfileContract
} from "../../../../packages/contracts/src";

const createdAtColumn = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAtColumn = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
const jsonObject = sql`'{}'::jsonb`;
const jsonArray = sql`'[]'::jsonb`;

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").unique(),
    primaryEmail: text("primary_email"),
    handle: text("handle").unique(),
    displayName: text("display_name").notNull(),
    imageUrl: text("image_url"),
    status: text("status").default("active").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("users_clerk_user_id_idx").on(table.clerkUserId),
    index("users_handle_idx").on(table.handle)
  ]
);

export const profiles = pgTable(
  "profiles",
  {
    handle: text("handle").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email"),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    likesPublic: boolean("likes_public").default(true).notNull(),
    resharesPublic: boolean("reshares_public").default(true).notNull(),
    role: text("role").notNull(),
    location: text("location").notNull(),
    bio: text("bio").notNull(),
    fields: jsonb("fields").$type<string[]>().default(jsonArray).notNull(),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("profiles_user_id_idx").on(table.userId),
    index("profiles_name_idx").on(table.name)
  ]
);

export const profileFollows = pgTable(
  "profile_follows",
  {
    followerHandle: text("follower_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    followingHandle: text("following_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    status: text("status").default("active").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    primaryKey({ columns: [table.followerHandle, table.followingHandle] }),
    index("profile_follows_following_idx").on(table.followingHandle),
    index("profile_follows_follower_idx").on(table.followerHandle)
  ]
);

export const communities = pgTable(
  "communities",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    field: text("field").notNull(),
    summary: text("summary").notNull(),
    visibility: text("visibility").notNull(),
    online: integer("online").default(0).notNull(),
    memberHandles: jsonb("member_handles").$type<string[]>().default(jsonArray).notNull(),
    keywords: jsonb("keywords").$type<string[]>().default(jsonArray).notNull(),
    seedCounts: jsonb("seed_counts").$type<ResearchCommunityContract["seedCounts"]>().default(jsonObject).notNull(),
    callStatus: text("call_status").default("quiet").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("communities_visibility_idx").on(table.visibility),
    index("communities_name_idx").on(table.name)
  ]
);

export const communityMemberships = pgTable(
  "community_memberships",
  {
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    profileHandle: text("profile_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    status: text("status").default("active").notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    primaryKey({ columns: [table.communityId, table.profileHandle] }),
    index("community_memberships_profile_idx").on(table.profileHandle)
  ]
);

export const communityChannels = pgTable(
  "community_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    settings: jsonb("settings").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("community_channels_unique_idx").on(table.communityId, table.kind, table.name)
  ]
);

export const communityCalls = pgTable(
  "community_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: text("community_id")
      .notNull()
      .references(() => communities.id, { onDelete: "cascade" }),
    hostHandle: text("host_handle").references(() => profiles.handle, { onDelete: "set null" }),
    title: text("title").notNull(),
    kind: text("kind").default("voice").notNull(),
    status: text("status").default("scheduled").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    provider: text("provider"),
    providerRoomId: text("provider_room_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("community_calls_community_idx").on(table.communityId),
    index("community_calls_status_idx").on(table.status),
    index("community_calls_host_idx").on(table.hostHandle)
  ]
);

export const callParticipants = pgTable(
  "call_participants",
  {
    callId: uuid("call_id")
      .notNull()
      .references(() => communityCalls.id, { onDelete: "cascade" }),
    profileHandle: text("profile_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    role: text("role").default("participant").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp("left_at", { withTimezone: true })
  },
  (table) => [
    primaryKey({ columns: [table.callId, table.profileHandle] }),
    index("call_participants_profile_idx").on(table.profileHandle)
  ]
);

export const posts = pgTable(
  "posts",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<ContentKindContract>().notNull(),
    room: text("room").notNull(),
    communityId: text("community_id").references(() => communities.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    authorHandle: text("author_handle").references(() => profiles.handle, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    affiliation: text("affiliation").notNull(),
    dateLabel: text("date_label").notNull(),
    status: text("status").notNull(),
    metrics: jsonb("metrics").$type<InquiryItemContract["metrics"]>().default(jsonObject).notNull(),
    gatheringReason: text("gathering_reason").notNull(),
    excerpt: text("excerpt").notNull(),
    body: text("body").notNull(),
    tags: jsonb("tags").$type<string[]>().default(jsonArray).notNull(),
    signals: jsonb("signals").$type<InquiryItemContract["signals"]>().default(jsonArray).notNull(),
    claims: jsonb("claims").$type<string[]>().default(jsonArray).notNull(),
    objections: jsonb("objections").$type<string[]>().default(jsonArray).notNull(),
    evidence: jsonb("evidence").$type<string[]>().default(jsonArray).notNull(),
    tests: jsonb("tests").$type<string[]>().default(jsonArray).notNull(),
    forks: jsonb("forks").$type<string[]>().default(jsonArray).notNull(),
    saved: boolean("saved").default(false).notNull(),
    savedBy: jsonb("saved_by").$type<string[]>().default(jsonArray).notNull(),
    signaledBy: jsonb("signaled_by").$type<string[]>().default(jsonArray).notNull(),
    forkedBy: jsonb("forked_by").$type<string[]>().default(jsonArray).notNull(),
    visibility: text("visibility").default("public").notNull(),
    searchText: text("search_text").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("posts_room_idx").on(table.room),
    index("posts_author_idx").on(table.authorHandle),
    index("posts_community_idx").on(table.communityId),
    index("posts_created_at_idx").on(table.createdAt)
  ]
);

export const opportunityPosts = pgTable(
  "opportunity_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    kind: text("kind").default("job").notNull(),
    status: text("status").default("open").notNull(),
    creatorHandle: text("creator_handle").references(() => profiles.handle, { onDelete: "set null" }),
    communityId: text("community_id").references(() => communities.id, { onDelete: "set null" }),
    location: text("location"),
    compensation: text("compensation"),
    tags: jsonb("tags").$type<string[]>().default(jsonArray).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("opportunity_posts_status_idx").on(table.status),
    index("opportunity_posts_creator_idx").on(table.creatorHandle),
    index("opportunity_posts_community_idx").on(table.communityId)
  ]
);

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    authorHandle: text("author_handle").references(() => profiles.handle, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    stance: text("stance").notNull(),
    body: text("body").notNull(),
    metrics: jsonb("metrics").$type<Pick<InquiryItemContract["metrics"], "signal" | "forks" | "saves" | "reads">>().default(jsonObject).notNull(),
    savedBy: jsonb("saved_by").$type<string[]>().default(jsonArray).notNull(),
    signaledBy: jsonb("signaled_by").$type<string[]>().default(jsonArray).notNull(),
    forkedBy: jsonb("forked_by").$type<string[]>().default(jsonArray).notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("comments_post_idx").on(table.postId),
    index("comments_parent_idx").on(table.parentId),
    index("comments_author_idx").on(table.authorHandle)
  ]
);

export const postActions = pgTable(
  "post_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    actorHandle: text("actor_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    action: text("action").notNull(),
    count: integer("count").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("post_actions_unique_idx").on(table.postId, table.actorHandle, table.action),
    index("post_actions_actor_idx").on(table.actorHandle)
  ]
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id"),
    uploaderHandle: text("uploader_handle").references(() => profiles.handle, { onDelete: "set null" }),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    status: text("status").default("pending").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("attachments_object_key_idx").on(table.objectKey),
    index("attachments_owner_idx").on(table.ownerType, table.ownerId)
  ]
);

export const previews = pgTable(
  "previews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "cascade" }),
    url: text("url"),
    title: text("title"),
    description: text("description"),
    imageUrl: text("image_url"),
    status: text("status").default("pending").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [index("previews_attachment_idx").on(table.attachmentId)]
);

export const externalLinks = pgTable(
  "external_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [index("external_links_owner_idx").on(table.ownerType, table.ownerId)]
);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").default("direct").notNull(),
  title: text("title"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
});

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    profileHandle: text("profile_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    createdAt: createdAtColumn()
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.profileHandle] }),
    index("conversation_participants_profile_idx").on(table.profileHandle)
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderHandle: text("sender_handle").references(() => profiles.handle, { onDelete: "set null" }),
    body: text("body").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("messages_conversation_idx").on(table.conversationId),
    index("messages_sender_idx").on(table.senderHandle)
  ]
);

export const messageReads = pgTable(
  "message_reads",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    profileHandle: text("profile_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [primaryKey({ columns: [table.messageId, table.profileHandle] })]
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerHandle: text("owner_handle").references(() => profiles.handle, { onDelete: "cascade" }),
    title: text("title").notNull(),
    contextType: text("context_type").default("general").notNull(),
    contextId: text("context_id"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("ai_conversations_owner_idx").on(table.ownerHandle),
    index("ai_conversations_context_idx").on(table.contextType, table.contextId)
  ]
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    body: text("body").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [index("ai_messages_conversation_idx").on(table.conversationId)]
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerHandle: text("owner_handle").references(() => profiles.handle, { onDelete: "cascade" }),
    name: text("name").notNull(),
    visibility: text("visibility").default("private").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("workspaces_owner_name_idx").on(table.ownerHandle, table.name),
    index("workspaces_owner_idx").on(table.ownerHandle)
  ]
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    visibility: text("visibility").default("private").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [index("notes_workspace_idx").on(table.workspaceId)]
);

export const noteBlocks = pgTable(
  "note_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    kind: text("kind").default("text").notNull(),
    body: text("body").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [index("note_blocks_note_idx").on(table.noteId)]
);

export const notePublications = pgTable(
  "note_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    postId: text("post_id").references(() => posts.id, { onDelete: "set null" }),
    publisherHandle: text("publisher_handle").references(() => profiles.handle, { onDelete: "set null" }),
    status: text("status").default("published").notNull(),
    visibility: text("visibility").default("public").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    index("note_publications_note_idx").on(table.noteId),
    index("note_publications_post_idx").on(table.postId),
    index("note_publications_publisher_idx").on(table.publisherHandle)
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileHandle: text("profile_handle").references(() => profiles.handle, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    index("notifications_profile_idx").on(table.profileHandle),
    index("notifications_read_idx").on(table.readAt)
  ]
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    actorHandle: text("actor_handle"),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    visibility: text("visibility").default("public").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    index("events_kind_idx").on(table.kind),
    index("events_subject_idx").on(table.subjectType, table.subjectId),
    index("events_actor_idx").on(table.actorHandle)
  ]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorHandle: text("actor_handle"),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [index("audit_logs_subject_idx").on(table.subjectType, table.subjectId)]
);

export const moderationReports = pgTable(
  "moderation_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterHandle: text("reporter_handle").references(() => profiles.handle, { onDelete: "set null" }),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").default("open").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [index("moderation_reports_status_idx").on(table.status)]
);

export const creditAccounts = pgTable(
  "credit_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    currency: text("currency").default("symposium_credit").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [uniqueIndex("credit_accounts_owner_idx").on(table.ownerType, table.ownerId, table.currency)]
);

export const creditLedgerEntries = pgTable(
  "credit_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => creditAccounts.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
    reason: text("reason").notNull(),
    actorHandle: text("actor_handle").references(() => profiles.handle, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex("credit_ledger_idempotency_idx").on(table.idempotencyKey),
    index("credit_ledger_account_idx").on(table.accountId)
  ]
);

export const bounties = pgTable(
  "bounties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    visibility: text("visibility").default("civic").notNull(),
    status: text("status").default("open").notNull(),
    communityId: text("community_id").references(() => communities.id, { onDelete: "set null" }),
    creatorHandle: text("creator_handle").references(() => profiles.handle, { onDelete: "set null" }),
    amountTarget: numeric("amount_target", { precision: 20, scale: 6 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [index("bounties_community_idx").on(table.communityId)]
);

export const pledges = pgTable(
  "pledges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bountyId: uuid("bounty_id").references(() => bounties.id, { onDelete: "cascade" }),
    pledgerHandle: text("pledger_handle").references(() => profiles.handle, { onDelete: "set null" }),
    amount: numeric("amount", { precision: 20, scale: 6 }).notNull(),
    status: text("status").default("pledged").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [index("pledges_bounty_idx").on(table.bountyId)]
);

export type ProfileRow = typeof profiles.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type CommunityRow = typeof communities.$inferSelect;
export type OpportunityPostRow = typeof opportunityPosts.$inferSelect;
export type CommunityCallRow = typeof communityCalls.$inferSelect;
export type ResearchProfileInsert = ResearchProfileContract & { userId?: string | null };
