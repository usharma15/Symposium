import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  check,
  date,
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
  ContentQuoteContract,
  ContentKindContract,
  InquiryItemContract,
  OpportunityPostInputContract,
  PatronageProposalInputContract,
  PostTypeContract,
  ResearchCommunityContract,
  ResearchProfileContract,
  VersionedDocumentContract
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
    actorKind: text("actor_kind").default("person").notNull(),
    era: text("era"),
    lifeDates: text("life_dates"),
    disclosure: text("disclosure"),
    sourceUrl: text("source_url"),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("profiles_user_id_idx").on(table.userId),
    index("profiles_name_idx").on(table.name),
    index("profiles_actor_kind_idx").on(table.actorKind, table.handle),
    check("profiles_actor_kind_check", sql`${table.actorKind} IN ('person', 'historical_simulation', 'editorial')`),
    index("profiles_search_document_idx").using("gin", sql`to_tsvector('english',
      coalesce(${table.name}, '') || ' ' || coalesce(${table.handle}, '') || ' ' || coalesce(${table.role}, '') || ' ' ||
      coalesce(${table.location}, '') || ' ' || coalesce(${table.bio}, '') || ' ' || coalesce(${table.fields}::text, '')
    )`),
    index("profiles_search_prefix_idx").using("gin", sql`to_tsvector('simple',
      coalesce(${table.name}, '') || ' ' || coalesce(${table.handle}, '') || ' ' || coalesce(${table.role}, '') || ' ' ||
      coalesce(${table.location}, '') || ' ' || coalesce(${table.bio}, '') || ' ' || coalesce(${table.fields}::text, '')
    )`)
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
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    primaryKey({ columns: [table.followerHandle, table.followingHandle] }),
    index("profile_follows_following_idx").on(table.followingHandle),
    index("profile_follows_follower_idx").on(table.followerHandle),
    check("profile_follows_no_self_check", sql`${table.followerHandle} <> ${table.followingHandle}`),
    check("profile_follows_status_check", sql`${table.status} IN ('active', 'muted', 'blocked', 'none')`),
    check("profile_follows_revision_check", sql`${table.revision} >= 1`)
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
    moderatorHandles: jsonb("moderator_handles").$type<string[]>().default(jsonArray).notNull(),
    guidelines: text("guidelines").default("").notNull(),
    announcements: jsonb("announcements").$type<NonNullable<ResearchCommunityContract["announcements"]>>().default(jsonArray).notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("communities_visibility_idx").on(table.visibility),
    index("communities_name_idx").on(table.name),
    index("communities_search_document_idx").using("gin", sql`to_tsvector('english',
      coalesce(${table.name}, '') || ' ' || coalesce(${table.field}, '') || ' ' ||
      coalesce(${table.summary}, '') || ' ' || coalesce(${table.keywords}::text, '')
    )`),
    index("communities_search_prefix_idx").using("gin", sql`to_tsvector('simple',
      coalesce(${table.name}, '') || ' ' || coalesce(${table.field}, '') || ' ' ||
      coalesce(${table.summary}, '') || ' ' || coalesce(${table.keywords}::text, '')
    )`)
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
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    primaryKey({ columns: [table.communityId, table.profileHandle] }),
    index("community_memberships_profile_idx").on(table.profileHandle),
    index("community_memberships_recent_idx").on(table.profileHandle, table.lastAccessedAt),
    index("community_memberships_listing_idx").on(table.communityId, table.status, table.createdAt, table.profileHandle),
    check(
      "community_memberships_status_check",
      sql`${table.status} IN ('active', 'requested', 'invited', 'rejected', 'blocked', 'removed')`
    )
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
    index("community_calls_host_idx").on(table.hostHandle),
    check("community_calls_kind_check", sql`${table.kind} IN ('voice', 'video')`),
    check("community_calls_status_check", sql`${table.status} IN ('scheduled', 'live', 'ended', 'cancelled')`)
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
    postType: text("post_type").$type<PostTypeContract>(),
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
    document: jsonb("content_document").$type<VersionedDocumentContract>(),
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
    quote: jsonb("quote").$type<ContentQuoteContract>(),
    patronage: jsonb("patronage").$type<InquiryItemContract["patronage"]>(),
    opportunity: jsonb("opportunity").$type<OpportunityPostInputContract>(),
    visibility: text("visibility").default("public").notNull(),
    searchText: text("search_text").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("posts_room_idx").on(table.room),
    index("posts_post_type_created_at_idx").on(table.postType, table.createdAt),
    index("posts_author_idx").on(table.authorHandle),
    index("posts_community_idx").on(table.communityId),
    index("posts_created_at_idx").on(table.createdAt),
    index("posts_created_id_idx").on(table.createdAt.desc(), table.id.desc()),
    index("posts_type_created_id_idx").on(table.postType, table.createdAt.desc(), table.id.desc()),
    index("posts_room_created_id_idx").on(table.room, table.createdAt.desc(), table.id.desc()),
    index("posts_community_created_id_idx").on(table.communityId, table.createdAt.desc(), table.id.desc()),
    index("posts_author_created_id_idx").on(table.authorHandle, table.createdAt.desc(), table.id.desc()),
    index("posts_search_prefix_idx").using("gin", sql`to_tsvector('simple', ${table.searchText})`),
    check(
      "posts_semantic_destination_check",
      sql`${table.postType} IS NULL OR (${table.postType} = 'proposal' AND ${table.room} = 'funding') OR (${table.postType} = 'opportunity' AND ${table.room} = 'opportunities') OR (${table.postType} IN ('paper', 'thought') AND ${table.room} NOT IN ('office', 'funding', 'opportunities'))`
    ),
    index("posts_quote_source_post_idx").on(sql`(${table.quote}->>'sourcePostId')`).where(sql`${table.quote} IS NOT NULL`),
    index("posts_quote_comment_source_idx").on(sql`(${table.quote}->>'sourceId')`).where(sql`${table.quote}->>'sourceType' = 'comment'`)
  ]
);

export const patronageProposals = pgTable(
  "patronage_proposals",
  {
    postId: text("post_id").primaryKey().references(() => posts.id, { onDelete: "cascade" }),
    status: text("status").default("open").notNull(),
    currency: text("currency").default("USD").notNull(),
    goalMinorUnits: bigint("goal_minor_units", { mode: "number" }).notNull(),
    deadline: date("deadline"),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("patronage_proposals_status_updated_idx").on(table.status, table.updatedAt),
    check("patronage_proposals_status_check", sql`${table.status} IN ('open', 'funded', 'closed')`),
    check("patronage_proposals_currency_check", sql`${table.currency} IN ('USD', 'EUR', 'GBP', 'CAD', 'AUD')`),
    check("patronage_proposals_goal_check", sql`${table.goalMinorUnits} > 0`),
    check("patronage_proposals_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const patronageContributions = pgTable(
  "patronage_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    contributorHandle: text("contributor_handle").references(() => profiles.handle, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    amountMinorUnits: bigint("amount_minor_units", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    anonymous: boolean("anonymous").default(false).notNull(),
    provider: text("provider").notNull(),
    providerReference: text("provider_reference"),
    status: text("status").default("pending").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("patronage_contributions_post_status_idx").on(table.postId, table.status, table.createdAt),
    index("patronage_contributions_contributor_idx").on(table.contributorHandle, table.createdAt),
    uniqueIndex("patronage_contributions_provider_reference_unique_idx").on(table.provider, table.providerReference),
    check("patronage_contributions_amount_check", sql`${table.amountMinorUnits} > 0`),
    check("patronage_contributions_currency_check", sql`${table.currency} IN ('USD', 'EUR', 'GBP', 'CAD', 'AUD')`),
    check("patronage_contributions_status_check", sql`${table.status} IN ('pending', 'confirmed', 'refunded', 'failed')`)
  ]
);

export const opportunityPosts = pgTable(
  "opportunity_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    document: jsonb("content_document").$type<VersionedDocumentContract>(),
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
    quote: jsonb("quote").$type<ContentQuoteContract>(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("comments_post_idx").on(table.postId),
    index("comments_parent_idx").on(table.parentId),
    index("comments_author_idx").on(table.authorHandle),
    index("comments_profile_activity_idx").on(table.authorHandle, table.createdAt, table.id).where(sql`${table.deletedAt} IS NULL`),
    index("comments_post_created_id_idx").on(table.postId, table.createdAt, table.id),
    index("comments_search_body_idx").using("gin", sql`to_tsvector('english', ${table.body})`),
    index("comments_search_prefix_idx").using("gin", sql`to_tsvector('simple', ${table.body})`),
    index("comments_quote_source_post_idx").on(sql`(${table.quote}->>'sourcePostId')`).where(sql`${table.quote} IS NOT NULL`),
    index("comments_quote_comment_source_idx").on(sql`(${table.quote}->>'sourceId')`).where(sql`${table.quote}->>'sourceType' = 'comment'`)
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
    active: boolean("active").default(true).notNull(),
    count: integer("count").default(1).notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("post_actions_unique_idx").on(table.postId, table.actorHandle, table.action),
    index("post_actions_actor_idx").on(table.actorHandle),
    index("post_actions_activity_idx").on(table.actorHandle, table.updatedAt, table.action, table.active),
    index("post_actions_profile_timeline_idx").on(table.actorHandle, table.action, table.updatedAt, table.postId),
    index("post_actions_viewer_active_idx").on(table.actorHandle, table.action, table.active, table.postId),
    check("post_actions_action_check", sql`${table.action} IN ('save', 'signal', 'fork', 'read')`),
    check("post_actions_count_check", sql`${table.count} >= 0`),
    check("post_actions_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const commentActions = pgTable(
  "comment_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: text("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    actorHandle: text("actor_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    action: text("action").notNull(),
    active: boolean("active").default(true).notNull(),
    count: integer("count").default(1).notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("comment_actions_unique_idx").on(table.commentId, table.actorHandle, table.action),
    index("comment_actions_actor_idx").on(table.actorHandle),
    index("comment_actions_post_idx").on(table.postId),
    index("comment_actions_activity_idx").on(table.actorHandle, table.updatedAt, table.action, table.active),
    index("comment_actions_profile_timeline_idx").on(table.actorHandle, table.action, table.updatedAt, table.commentId),
    index("comment_actions_viewer_active_idx").on(table.actorHandle, table.action, table.active, table.commentId),
    check("comment_actions_action_check", sql`${table.action} IN ('save', 'signal', 'fork')`),
    check("comment_actions_count_check", sql`${table.count} >= 0`),
    check("comment_actions_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const contentViews = pgTable(
  "content_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    actorHandle: text("actor_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    trigger: text("trigger"),
    surface: text("surface"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("content_views_unique_bucket_idx").on(
      table.targetType,
      table.targetId,
      table.actorHandle,
      table.bucketStart
    ),
    index("content_views_target_idx").on(table.targetType, table.targetId),
    index("content_views_actor_idx").on(table.actorHandle),
    index("content_views_created_idx").on(table.createdAt)
  ]
);

export const opportunityApplications = pgTable(
  "opportunity_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    applicantHandle: text("applicant_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    shortlisted: boolean("shortlisted").default(false).notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("opportunity_applications_post_applicant_unique_idx").on(table.postId, table.applicantHandle),
    index("opportunity_applications_post_shortlisted_idx").on(table.postId, table.shortlisted, table.createdAt),
    index("opportunity_applications_applicant_idx").on(table.applicantHandle, table.createdAt),
    check("opportunity_applications_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const opportunityApplicationComments = pgTable(
  "opportunity_application_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id").notNull().references(() => opportunityApplications.id, { onDelete: "cascade" }),
    authorHandle: text("author_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    index("opportunity_application_comments_application_idx").on(table.applicationId, table.createdAt)
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
    uploadObjectKey: text("upload_object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    status: text("status").default("pending").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("attachments_object_key_idx").on(table.objectKey),
    uniqueIndex("attachments_upload_object_key_idx").on(table.uploadObjectKey),
    index("attachments_owner_idx").on(table.ownerType, table.ownerId),
    index("attachments_uploader_status_idx").on(table.uploaderHandle, table.status, table.createdAt),
    index("attachments_status_updated_idx").on(table.status, table.updatedAt),
    check("attachments_owner_type_check", sql`${table.ownerType} IN ('post', 'comment', 'message', 'note', 'note_comment', 'opportunity_application', 'profile')`),
    check("attachments_status_check", sql`${table.status} IN ('pending', 'verifying', 'uploaded', 'previewed', 'failed')`),
    check("attachments_byte_size_check", sql`${table.byteSize} > 0 AND ${table.byteSize} <= 52428800`)
  ]
);

export const storageDeletionJobs = pgTable(
  "storage_deletion_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attachmentId: uuid("attachment_id").references(() => attachments.id, { onDelete: "set null" }),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    reason: text("reason").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("storage_deletion_jobs_object_idx").on(table.bucket, table.objectKey),
    index("storage_deletion_jobs_due_idx").on(table.nextAttemptAt, table.leaseExpiresAt),
    index("storage_deletion_jobs_attachment_idx").on(table.attachmentId),
    check("storage_deletion_jobs_attempts_check", sql`${table.attempts} >= 0`)
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

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").default("direct").notNull(),
    title: text("title"),
    ownerHandle: text("owner_handle").references(() => profiles.handle, { onDelete: "set null" }),
    revision: integer("revision").default(1).notNull(),
    nextMessageSequence: bigint("next_message_sequence", { mode: "number" }).default(0).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("conversations_updated_idx").on(table.updatedAt, table.id),
    check("conversations_kind_check", sql`${table.kind} IN ('direct', 'group')`),
    check("conversations_revision_check", sql`${table.revision} >= 1`),
    check("conversations_sequence_check", sql`${table.nextMessageSequence} >= 0`)
  ]
);

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
    status: text("status").default("active").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    lastReadSequence: bigint("last_read_sequence", { mode: "number" }).default(0).notNull(),
    clearedThroughSequence: bigint("cleared_through_sequence", { mode: "number" }).default(0).notNull(),
    removedThroughSequence: bigint("removed_through_sequence", { mode: "number" }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    muted: boolean("muted").default(false).notNull(),
    pinned: boolean("pinned").default(false).notNull(),
    draftBody: text("draft_body").default("").notNull(),
    draftUpdatedAt: timestamp("draft_updated_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: createdAtColumn()
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.profileHandle] }),
    index("conversation_participants_profile_idx").on(table.profileHandle),
    index("conversation_participants_profile_status_idx").on(table.profileHandle, table.status, table.hiddenAt),
    check("conversation_participants_role_check", sql`${table.role} IN ('owner', 'admin', 'member')`),
    check("conversation_participants_status_check", sql`${table.status} IN ('invited', 'active', 'removed')`),
    check("conversation_participants_read_sequence_check", sql`${table.lastReadSequence} >= 0`),
    check("conversation_participants_cleared_sequence_check", sql`${table.clearedThroughSequence} >= 0`)
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    revision: integer("revision").default(1).notNull(),
    senderHandle: text("sender_handle").references(() => profiles.handle, { onDelete: "set null" }),
    body: text("body").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by").references(() => profiles.handle, { onDelete: "set null" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("messages_sender_idx").on(table.senderHandle),
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    uniqueIndex("messages_conversation_sequence_idx").on(table.conversationId, table.sequence),
    index("messages_search_body_idx").using("gin", sql`to_tsvector('english', ${table.body})`),
    check("messages_sequence_check", sql`${table.sequence} > 0`),
    check("messages_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const messageStars = pgTable(
  "message_stars",
  {
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    profileHandle: text("profile_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    createdAt: createdAtColumn()
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.profileHandle] }),
    index("message_stars_profile_created_idx").on(table.profileHandle, table.createdAt)
  ]
);

export const messageHiddenFor = pgTable(
  "message_hidden_for",
  {
    messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    profileHandle: text("profile_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    createdAt: createdAtColumn()
  },
  (table) => [primaryKey({ columns: [table.messageId, table.profileHandle] })]
);

export const profileBlocks = pgTable(
  "profile_blocks",
  {
    blockerHandle: text("blocker_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    blockedHandle: text("blocked_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    createdAt: createdAtColumn()
  },
  (table) => [
    primaryKey({ columns: [table.blockerHandle, table.blockedHandle] }),
    index("profile_blocks_blocked_idx").on(table.blockedHandle),
    check("profile_blocks_not_self_check", sql`${table.blockerHandle} <> ${table.blockedHandle}`)
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
    ownerHandle: text("owner_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
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
  (table) => [
    index("ai_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    check("ai_messages_role_check", sql`${table.role} IN ('user', 'assistant', 'system')`)
  ]
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    ownerHandle: text("owner_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    model: text("model").notNull(),
    status: text("status").default("reserved").notNull(),
    reservedCostMicros: bigint("reserved_cost_micros", { mode: "number" }).notNull(),
    actualCostMicros: bigint("actual_cost_micros", { mode: "number" }),
    inputTokens: integer("input_tokens").default(0).notNull(),
    cachedInputTokens: integer("cached_input_tokens").default(0).notNull(),
    cacheWriteTokens: integer("cache_write_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    providerResponseId: text("provider_response_id"),
    errorCode: text("error_code"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("ai_usage_owner_created_idx").on(table.ownerHandle, table.createdAt),
    index("ai_usage_created_idx").on(table.createdAt),
    index("ai_usage_status_created_idx").on(table.status, table.createdAt),
    check("ai_usage_status_check", sql`${table.status} IN ('reserved', 'completed', 'failed')`),
    check("ai_usage_cost_check", sql`${table.reservedCostMicros} >= 0 AND (${table.actualCostMicros} IS NULL OR ${table.actualCostMicros} >= 0)`),
    check("ai_usage_token_check", sql`${table.inputTokens} >= 0 AND ${table.cachedInputTokens} >= 0 AND ${table.cacheWriteTokens} >= 0 AND ${table.outputTokens} >= 0`)
  ]
);

export const aiDailyQuotaResets = pgTable(
  "ai_daily_quota_resets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerHandle: text("owner_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    usageDay: date("usage_day").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex("ai_daily_quota_resets_owner_day_unique_idx").on(table.ownerHandle, table.usageDay),
    index("ai_daily_quota_resets_day_idx").on(table.usageDay)
  ]
);

export const documentTranslations = pgTable(
  "document_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attachmentId: text("attachment_id").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    sourceTitle: text("source_title").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceComplete: boolean("source_complete").notNull(),
    targetLanguage: text("target_language").notNull(),
    targetLanguageLabel: text("target_language_label").notNull(),
    translatedTitle: text("translated_title").notNull(),
    pages: jsonb("pages").$type<Array<{ pageNumber: number; body: string }>>().default(jsonArray).notNull(),
    model: text("model").notNull(),
    creatorHandle: text("creator_handle").references(() => profiles.handle, { onDelete: "set null" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("document_translations_source_language_unique_idx").on(table.attachmentId, table.sourceFingerprint, table.targetLanguage),
    index("document_translations_created_idx").on(table.createdAt),
    check("document_translations_source_kind_check", sql`${table.sourceKind} IN ('docx', 'pdf')`),
    check("document_translations_language_check", sql`${table.targetLanguage} IN ('english', 'french', 'german', 'spanish')`),
    check("document_translations_fingerprint_check", sql`${table.sourceFingerprint} ~ '^[a-f0-9]{64}$'`),
    check("document_translations_pages_check", sql`jsonb_typeof(${table.pages}) = 'array' AND jsonb_array_length(${table.pages}) BETWEEN 1 AND 40`)
  ]
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
    index("workspaces_owner_idx").on(table.ownerHandle),
    check("workspaces_visibility_check", sql`${table.visibility} IN ('private', 'community', 'public')`)
  ]
);

export const workspaceNotebooks = pgTable(
  "workspace_notebooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ownerHandle: text("owner_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    name: text("name").notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => [
    index("workspace_notebooks_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    check("workspace_notebooks_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ownerHandle: text("owner_handle").references(() => profiles.handle, { onDelete: "cascade" }),
    notebookId: uuid("notebook_id").references(() => workspaceNotebooks.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body").default("").notNull(),
    document: jsonb("content_document").$type<VersionedDocumentContract>(),
    kind: text("kind").default("note").notNull(),
    publicationTarget: text("publication_target").default("undecided").notNull(),
    proposal: jsonb("proposal").$type<PatronageProposalInputContract>(),
    opportunity: jsonb("opportunity").$type<OpportunityPostInputContract>(),
    targetId: text("target_id"),
    lifecycle: text("lifecycle").default("draft").notNull(),
    visibility: text("visibility").default("private").notNull(),
    revision: integer("revision").default(1).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedPostId: text("published_post_id").references(() => posts.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("notes_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    index("notes_owner_updated_idx").on(table.ownerHandle, table.updatedAt),
    index("notes_notebook_updated_idx").on(table.notebookId, table.updatedAt),
    check("notes_visibility_check", sql`${table.visibility} = 'private'`),
    check("notes_kind_check", sql`${table.kind} IN ('note', 'paper', 'thought', 'comment', 'reply', 'quick')`),
    check("notes_publication_target_check", sql`${table.publicationTarget} IN ('undecided', 'paper', 'thought', 'proposal', 'opportunity', 'comment', 'reply')`),
    check("notes_lifecycle_check", sql`${table.lifecycle} IN ('draft', 'published', 'archived')`),
    check("notes_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const workspaceScribbles = pgTable(
  "workspace_scribbles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    ownerHandle: text("owner_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    body: text("body").default("").notNull(),
    document: jsonb("content_document").$type<VersionedDocumentContract>().notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("workspace_scribbles_owner_unique_idx").on(table.ownerHandle),
    index("workspace_scribbles_workspace_idx").on(table.workspaceId),
    check("workspace_scribbles_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const workspaceScribbleRevisions = pgTable(
  "workspace_scribble_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scribbleId: uuid("scribble_id").notNull().references(() => workspaceScribbles.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    editorHandle: text("editor_handle").references(() => profiles.handle, { onDelete: "set null" }),
    body: text("body").notNull(),
    document: jsonb("content_document").$type<VersionedDocumentContract>().notNull(),
    reason: text("reason").default("autosave").notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex("workspace_scribble_revisions_scribble_revision_unique_idx").on(table.scribbleId, table.revision),
    index("workspace_scribble_revisions_scribble_created_idx").on(table.scribbleId, table.createdAt),
    check("workspace_scribble_revisions_reason_check", sql`${table.reason} IN ('created', 'autosave', 'filed', 'discarded', 'restored')`)
  ]
);

export const workspaceNoteRevisions = pgTable(
  "workspace_note_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    editorHandle: text("editor_handle").references(() => profiles.handle, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    document: jsonb("content_document").$type<VersionedDocumentContract>().notNull(),
    kind: text("kind").notNull(),
    publicationTarget: text("publication_target").notNull(),
    proposal: jsonb("proposal").$type<PatronageProposalInputContract>(),
    opportunity: jsonb("opportunity").$type<OpportunityPostInputContract>(),
    targetId: text("target_id"),
    notebookId: uuid("notebook_id").references(() => workspaceNotebooks.id, { onDelete: "set null" }),
    attachmentIds: uuid("attachment_ids").array().default(sql`ARRAY[]::UUID[]`).notNull(),
    reason: text("reason").default("checkpoint").notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    uniqueIndex("workspace_note_revisions_note_revision_unique_idx").on(table.noteId, table.revision),
    index("workspace_note_revisions_note_created_idx").on(table.noteId, table.createdAt)
  ]
);

export const workspaceNotebookGrants = pgTable(
  "workspace_notebook_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notebookId: uuid("notebook_id").notNull().references(() => workspaceNotebooks.id, { onDelete: "cascade" }),
    granteeHandle: text("grantee_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    role: text("role").notNull(),
    revision: integer("revision").default(1).notNull(),
    grantedByHandle: text("granted_by_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("workspace_notebook_grants_notebook_grantee_unique_idx").on(table.notebookId, table.granteeHandle),
    index("workspace_notebook_grants_grantee_idx").on(table.granteeHandle, table.notebookId),
    check("workspace_notebook_grants_role_check", sql`${table.role} IN ('viewer', 'commenter', 'editor', 'publisher')`),
    check("workspace_notebook_grants_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const workspaceNoteGrants = pgTable(
  "workspace_note_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    granteeHandle: text("grantee_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    role: text("role").notNull(),
    revision: integer("revision").default(1).notNull(),
    grantedByHandle: text("granted_by_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("workspace_note_grants_note_grantee_unique_idx").on(table.noteId, table.granteeHandle),
    index("workspace_note_grants_grantee_idx").on(table.granteeHandle, table.noteId),
    check("workspace_note_grants_role_check", sql`${table.role} IN ('viewer', 'commenter', 'editor', 'publisher')`),
    check("workspace_note_grants_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const workspaceNoteComments = pgTable(
  "workspace_note_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    authorHandle: text("author_handle").references(() => profiles.handle, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    stance: text("stance").default("Comment").notNull(),
    body: text("body").notNull(),
    document: jsonb("content_document").$type<VersionedDocumentContract>(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
  },
  (table) => [
    index("workspace_note_comments_note_created_idx").on(table.noteId, table.createdAt),
    index("workspace_note_comments_parent_idx").on(table.parentId),
    check("workspace_note_comments_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const workspaceNoteCommentActions = pgTable(
  "workspace_note_comment_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id").notNull().references(() => workspaceNoteComments.id, { onDelete: "cascade" }),
    noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
    actorHandle: text("actor_handle").notNull().references(() => profiles.handle, { onDelete: "cascade" }),
    action: text("action").notNull(),
    active: boolean("active").default(true).notNull(),
    count: integer("count").default(1).notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("workspace_note_comment_actions_unique_idx").on(table.commentId, table.actorHandle, table.action),
    index("workspace_note_comment_actions_note_idx").on(table.noteId),
    index("workspace_note_comment_actions_actor_idx").on(table.actorHandle),
    check("workspace_note_comment_actions_action_check", sql`${table.action} IN ('save', 'signal')`),
    check("workspace_note_comment_actions_count_check", sql`${table.count} >= 0`),
    check("workspace_note_comment_actions_revision_check", sql`${table.revision} >= 1`)
  ]
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
    revision: integer("revision").default(1).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    index("note_blocks_note_updated_idx").on(table.noteId, table.updatedAt),
    check("note_blocks_revision_check", sql`${table.revision} >= 1`)
  ]
);

export const notePublications = pgTable(
  "note_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "set null" }),
    noteRevision: integer("note_revision"),
    checkpointId: uuid("checkpoint_id").references(() => workspaceNoteRevisions.id, { onDelete: "set null" }),
    publishedCommentId: text("published_comment_id").references(() => comments.id, { onDelete: "set null" }),
    postId: text("post_id").references(() => posts.id, { onDelete: "set null" }),
    publisherHandle: text("publisher_handle").references(() => profiles.handle, { onDelete: "set null" }),
    status: text("status").default("published").notNull(),
    visibility: text("visibility").default("public").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    index("note_publications_note_idx").on(table.noteId),
    uniqueIndex("note_publications_revision_unique_idx").on(table.noteId, table.noteRevision).where(sql`${table.noteId} IS NOT NULL AND ${table.noteRevision} IS NOT NULL`),
    uniqueIndex("note_publications_post_unique_idx").on(table.postId).where(sql`${table.postId} IS NOT NULL`),
    index("note_publications_publisher_idx").on(table.publisherHandle),
    check("note_publications_visibility_check", sql`${table.visibility} IN ('private', 'community', 'public')`)
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
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    index("notifications_read_idx").on(table.readAt),
    index("notifications_profile_created_idx").on(table.profileHandle, table.createdAt),
    index("notifications_retention_idx").on(table.createdAt).where(sql`${table.readAt} IS NOT NULL`),
    uniqueIndex("notifications_profile_dedupe_idx").on(table.profileHandle, table.dedupeKey).where(sql`${table.dedupeKey} IS NOT NULL`)
  ]
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    actorHandle: text("actor_handle"),
    audienceHandles: jsonb("audience_handles").$type<string[]>().default(jsonArray).notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    visibility: text("visibility").default("public").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default(jsonObject).notNull(),
    createdAt: createdAtColumn()
  },
  (table) => [
    index("events_kind_idx").on(table.kind),
    index("events_subject_idx").on(table.subjectType, table.subjectId),
    index("events_actor_idx").on(table.actorHandle),
    index("events_created_idx").on(table.createdAt),
    index("events_delivery_idx").on(table.visibility, table.createdAt, table.id),
    index("events_audience_handles_idx").using("gin", table.audienceHandles),
    check("events_visibility_check", sql`${table.visibility} IN ('public', 'private', 'community')`)
  ]
);

export const mutationReceipts = pgTable(
  "mutation_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorHandle: text("actor_handle")
      .notNull()
      .references(() => profiles.handle, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").default("pending").notNull(),
    response: jsonb("response").$type<unknown>(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn()
  },
  (table) => [
    uniqueIndex("mutation_receipts_unique_idx").on(table.actorHandle, table.scope, table.idempotencyKey),
    index("mutation_receipts_actor_idx").on(table.actorHandle, table.createdAt),
    index("mutation_receipts_created_idx").on(table.createdAt),
    check("mutation_receipts_status_check", sql`${table.status} IN ('pending', 'completed')`),
    check(
      "mutation_receipts_idempotency_key_check",
      sql`char_length(${table.idempotencyKey}) BETWEEN 8 AND 200`
    ),
    check("mutation_receipts_request_hash_check", sql`char_length(${table.requestHash}) = 64`)
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
  (table) => [
    index("audit_logs_subject_idx").on(table.subjectType, table.subjectId),
    index("audit_logs_actor_idx").on(table.actorHandle, table.createdAt),
    index("audit_logs_created_idx").on(table.createdAt)
  ]
);

export const maintenanceLeases = pgTable(
  "maintenance_leases",
  {
    key: text("key").primaryKey(),
    lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    updatedAt: updatedAtColumn()
  }
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
export type ContentViewRow = typeof contentViews.$inferSelect;
export type CommunityRow = typeof communities.$inferSelect;
export type OpportunityPostRow = typeof opportunityPosts.$inferSelect;
export type CommunityCallRow = typeof communityCalls.$inferSelect;
export type ResearchProfileInsert = ResearchProfileContract & { userId?: string | null };
