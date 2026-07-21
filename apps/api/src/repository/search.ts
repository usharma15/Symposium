import {
  searchInputSchema,
  type SearchResponseContract
} from "../../../../packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import { ensureLiveData, listPublicCommunities, publicProfile, seedSnapshot } from "./foundation";
import { listPostPage } from "./inquiryReads";

const prefixTsQuery = (query: string) =>
  (query.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
    .slice(0, 12)
    .map((token) => `'${token}':*`)
    .join(" & ");

const localCommentText = (comments: ReturnType<typeof seedSnapshot>["items"][number]["comments"]): string =>
  comments.map((comment) => [comment.deletedAt ? "" : comment.body, localCommentText(comment.replies ?? [])].join(" ")).join(" ");

export const search = async (
  rawInput: unknown,
  rawRequesterHandle?: string | null
): Promise<SearchResponseContract> => {
  const input = searchInputSchema.parse(rawInput);
  const requesterHandle = rawRequesterHandle ? cleanHandle(rawRequesterHandle) : null;
  const prefixQuery = prefixTsQuery(input.query);
  if (!prefixQuery) return { posts: [], profiles: [], communities: [], nextCursor: null };

  if (!hasDatabase()) {
    const term = input.query.toLowerCase();
    const snapshot = seedSnapshot();
    const scopedCommunity = input.communityId
      ? snapshot.communities?.find((community) => community.id === input.communityId)
      : undefined;
    const canReadScopedCommunity = !scopedCommunity
      || scopedCommunity.visibility === "public"
      || Boolean(requesterHandle && scopedCommunity.memberHandles.some((handle) => cleanHandle(handle) === requesterHandle));
    return {
      posts: snapshot.items
        .filter((item) => !item.deletedAt && item.room !== "office" && item.kind !== "draft")
        .filter((item) => input.communityId
          ? canReadScopedCommunity && item.communityId === input.communityId
          : !item.communityId || item.postType === "paper")
        .filter((item) => !input.room || item.room === input.room)
        .filter((item) => !input.postTypes?.length || Boolean(item.postType && input.postTypes.includes(item.postType)))
        .filter((item) => [item.title, item.body, item.excerpt, item.author, ...item.tags, localCommentText(item.comments)]
          .join(" ").toLowerCase().includes(term))
        .slice(0, input.limit)
        .map((item) => ({
          ...item,
          commentCount: item.comments.reduce(function count(total, comment): number {
            return total + (comment.deletedAt ? 0 : 1) + (comment.replies ?? []).reduce(count, 0);
          }, 0),
          detailLoaded: false,
          comments: [],
          saved: Boolean(requesterHandle && item.savedBy?.some((handle) => cleanHandle(handle) === requesterHandle)),
          savedBy: requesterHandle && item.savedBy?.some((handle) => cleanHandle(handle) === requesterHandle) ? [requesterHandle] : [],
          signaledBy: requesterHandle && item.signaledBy?.some((handle) => cleanHandle(handle) === requesterHandle) ? [requesterHandle] : [],
          forkedBy: requesterHandle && item.forkedBy?.some((handle) => cleanHandle(handle) === requesterHandle) ? [requesterHandle] : []
        })),
      profiles: Object.values(snapshot.profiles)
        .filter((person) => [person.name, person.handle, person.role, person.location, person.bio, ...person.fields]
          .join(" ").toLowerCase().includes(term))
        .slice(0, input.limit)
        .map(publicProfile),
      communities: (await listPublicCommunities(requesterHandle))
        .filter((community) => [community.name, community.field, community.summary, ...community.keywords]
          .join(" ").toLowerCase().includes(term))
        .slice(0, input.limit),
      nextCursor: null
    };
  }

  await ensureLiveData();
  const [postMatches, profileResult, communityResult] = await Promise.all([
    getPool().query<{ id: string; rank: number }>(
      `WITH query AS (
         SELECT
           websearch_to_tsquery('english', $1) AS exact_value,
           to_tsquery('simple', $2) AS prefix_value
       ), visible_posts AS NOT MATERIALIZED (
         SELECT post.id, post.search_text, post.created_at
         FROM posts post
         LEFT JOIN communities community ON community.id = post.community_id
         WHERE post.deleted_at IS NULL
           AND post.room <> 'office'
           AND post.kind <> 'draft'
           AND ($5::text IS NULL OR post.room = $5)
           AND ($6::text[] IS NULL OR post.post_type = ANY($6::text[]))
           AND (
             ($4::text IS NULL AND (post.community_id IS NULL OR post.post_type = 'paper'))
             OR ($4::text IS NOT NULL AND post.community_id = $4 AND (
               post.post_type = 'paper'
               OR community.visibility = 'public'
               OR ($3::text IS NOT NULL AND post.author_handle = $3)
               OR EXISTS (
                 SELECT 1 FROM community_memberships viewer
                 WHERE viewer.community_id = post.community_id
                   AND viewer.profile_handle = $3
                   AND viewer.status = 'active'
               )
             ))
           )
       ), matches AS (
         SELECT
           post.id,
           GREATEST(
             ts_rank_cd(to_tsvector('english', post.search_text), query.exact_value) * 1.2,
             ts_rank_cd(to_tsvector('simple', post.search_text), query.prefix_value)
           ) AS rank,
           post.created_at
         FROM visible_posts post
         CROSS JOIN query
         WHERE to_tsvector('english', post.search_text) @@ query.exact_value
            OR to_tsvector('simple', post.search_text) @@ query.prefix_value
         UNION ALL
         SELECT
           post.id,
           GREATEST(
             ts_rank_cd(to_tsvector('english', comment.body), query.exact_value) * 0.86,
             ts_rank_cd(to_tsvector('simple', comment.body), query.prefix_value) * 0.72
           ) AS rank,
           post.created_at
         FROM comments comment
         JOIN visible_posts post ON post.id = comment.post_id
         CROSS JOIN query
         WHERE comment.deleted_at IS NULL
           AND (to_tsvector('english', comment.body) @@ query.exact_value
             OR to_tsvector('simple', comment.body) @@ query.prefix_value)
       )
       SELECT id, max(rank)::float AS rank
       FROM matches
       GROUP BY id
       ORDER BY max(rank) DESC, max(created_at) DESC, id DESC
       LIMIT $7`,
      [
        input.query,
        prefixQuery,
        requesterHandle,
        input.communityId ?? null,
        input.room ?? null,
        input.postTypes ?? null,
        input.limit
      ]
    ),
    input.communityId ? Promise.resolve({ rows: [] }) : getPool().query(
      `WITH query AS (
         SELECT websearch_to_tsquery('english', $1) AS exact_value, to_tsquery('simple', $2) AS prefix_value
       )
       SELECT
         profile.handle,
         profile.name,
         profile.avatar_url AS "avatarUrl",
         profile.likes_public AS "likesPublic",
         profile.reshares_public AS "resharesPublic",
         profile.role,
         profile.location,
         profile.bio,
         profile.fields,
         profile.actor_kind AS "actorKind",
         profile.era,
         profile.life_dates AS "lifeDates",
         profile.disclosure,
         profile.source_url AS "sourceUrl",
         profile.revision
       FROM profiles profile
       CROSS JOIN query
       WHERE to_tsvector('english',
           coalesce(profile.name, '') || ' ' || coalesce(profile.handle, '') || ' ' || coalesce(profile.role, '') || ' ' ||
           coalesce(profile.location, '') || ' ' || coalesce(profile.bio, '') || ' ' || coalesce(profile.fields::text, '')
         ) @@ query.exact_value
         OR to_tsvector('simple',
           coalesce(profile.name, '') || ' ' || coalesce(profile.handle, '') || ' ' || coalesce(profile.role, '') || ' ' ||
           coalesce(profile.location, '') || ' ' || coalesce(profile.bio, '') || ' ' || coalesce(profile.fields::text, '')
         ) @@ query.prefix_value
       ORDER BY GREATEST(
         ts_rank_cd(to_tsvector('english',
           coalesce(profile.name, '') || ' ' || coalesce(profile.handle, '') || ' ' || coalesce(profile.role, '') || ' ' ||
           coalesce(profile.location, '') || ' ' || coalesce(profile.bio, '') || ' ' || coalesce(profile.fields::text, '')
         ), query.exact_value) * 1.2,
         ts_rank_cd(to_tsvector('simple',
           coalesce(profile.name, '') || ' ' || coalesce(profile.handle, '') || ' ' || coalesce(profile.role, '') || ' ' ||
           coalesce(profile.location, '') || ' ' || coalesce(profile.bio, '') || ' ' || coalesce(profile.fields::text, '')
         ), query.prefix_value)
       ) DESC, profile.name ASC
       LIMIT $3`,
      [input.query, prefixQuery, input.limit]
    ),
    input.communityId ? Promise.resolve({ rows: [] }) : getPool().query(
      `WITH query AS (
         SELECT websearch_to_tsquery('english', $1) AS exact_value, to_tsquery('simple', $2) AS prefix_value
       )
       SELECT community.id
       FROM communities community
       CROSS JOIN query
       WHERE to_tsvector('english',
           coalesce(community.name, '') || ' ' || coalesce(community.field, '') || ' ' ||
           coalesce(community.summary, '') || ' ' || coalesce(community.keywords::text, '')
         ) @@ query.exact_value
         OR to_tsvector('simple',
           coalesce(community.name, '') || ' ' || coalesce(community.field, '') || ' ' ||
           coalesce(community.summary, '') || ' ' || coalesce(community.keywords::text, '')
         ) @@ query.prefix_value
       ORDER BY GREATEST(
         ts_rank_cd(to_tsvector('english',
           coalesce(community.name, '') || ' ' || coalesce(community.field, '') || ' ' ||
           coalesce(community.summary, '') || ' ' || coalesce(community.keywords::text, '')
         ), query.exact_value) * 1.2,
         ts_rank_cd(to_tsvector('simple',
           coalesce(community.name, '') || ' ' || coalesce(community.field, '') || ' ' ||
           coalesce(community.summary, '') || ' ' || coalesce(community.keywords::text, '')
         ), query.prefix_value)
       ) DESC, community.name ASC
       LIMIT $3`,
      [input.query, prefixQuery, input.limit]
    )
  ]);

  const rankedIds = postMatches.rows.map((row) => row.id);
  const postPage = rankedIds.length
    ? await listPostPage({ ids: rankedIds, limit: rankedIds.length }, requesterHandle)
    : { items: [], profiles: {}, nextCursor: null };
  const byId = new Map(postPage.items.map((item) => [item.id, item]));
  const communityIds = new Set(communityResult.rows.map((row) => String(row.id)));
  const communities = (await listPublicCommunities(requesterHandle))
    .filter((community) => communityIds.has(community.id));

  return {
    posts: rankedIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []),
    profiles: profileResult.rows.map((person) => publicProfile({
      ...(person as Parameters<typeof publicProfile>[0]),
      avatarUrl: (person as { avatarUrl?: string | null }).avatarUrl ?? undefined
    })),
    communities,
    nextCursor: null
  };
};
