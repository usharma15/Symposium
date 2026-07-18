import {
  searchInputSchema,
  type SearchResponseContract
} from "../../../../packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import { ensureLiveData, listPublicCommunities, publicProfile, seedSnapshot } from "./foundation";
import { listPostPage } from "./inquiryReads";

export const search = async (
  rawInput: unknown,
  rawRequesterHandle?: string | null
): Promise<SearchResponseContract> => {
  const input = searchInputSchema.parse(rawInput);
  const requesterHandle = rawRequesterHandle ? cleanHandle(rawRequesterHandle) : null;

  if (!hasDatabase()) {
    const term = input.query.toLowerCase();
    const snapshot = seedSnapshot();
    return {
      posts: snapshot.items
        .filter((item) => !item.deletedAt && item.room !== "office" && item.kind !== "draft")
        .filter((item) => !item.communityId || item.postType === "paper")
        .filter((item) => [item.title, item.body, item.excerpt, item.author, ...item.tags]
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
         SELECT websearch_to_tsquery('english', $1) AS value
       ), matches AS (
         SELECT
           post.id,
           ts_rank_cd(to_tsvector('english', post.search_text), query.value) AS rank,
           post.created_at
         FROM posts post
         CROSS JOIN query
         WHERE post.deleted_at IS NULL
           AND post.room <> 'office'
           AND post.kind <> 'draft'
           AND (post.community_id IS NULL OR post.post_type = 'paper')
           AND to_tsvector('english', post.search_text) @@ query.value
         UNION ALL
         SELECT
           post.id,
           ts_rank_cd(to_tsvector('english', comment.body), query.value) * 0.72 AS rank,
           post.created_at
         FROM comments comment
         JOIN posts post ON post.id = comment.post_id
         CROSS JOIN query
         WHERE comment.deleted_at IS NULL
           AND post.deleted_at IS NULL
           AND post.room <> 'office'
           AND post.kind <> 'draft'
           AND (post.community_id IS NULL OR post.post_type = 'paper')
           AND to_tsvector('english', comment.body) @@ query.value
       )
       SELECT id, max(rank)::float AS rank
       FROM matches
       GROUP BY id
       ORDER BY max(rank) DESC, max(created_at) DESC, id DESC
       LIMIT $2`,
      [input.query, input.limit]
    ),
    getPool().query(
      `WITH query AS (SELECT websearch_to_tsquery('english', $1) AS value)
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
         profile.revision
       FROM profiles profile
       CROSS JOIN query
       WHERE to_tsvector('english',
         coalesce(profile.name, '') || ' ' || coalesce(profile.handle, '') || ' ' || coalesce(profile.role, '') || ' ' ||
         coalesce(profile.location, '') || ' ' || coalesce(profile.bio, '') || ' ' || coalesce(profile.fields::text, '')
       ) @@ query.value
       ORDER BY ts_rank_cd(
         to_tsvector('english',
           coalesce(profile.name, '') || ' ' || coalesce(profile.handle, '') || ' ' || coalesce(profile.role, '') || ' ' ||
           coalesce(profile.location, '') || ' ' || coalesce(profile.bio, '') || ' ' || coalesce(profile.fields::text, '')
         ),
         query.value
       ) DESC, profile.name ASC
       LIMIT $2`,
      [input.query, input.limit]
    ),
    getPool().query(
      `WITH query AS (SELECT websearch_to_tsquery('english', $1) AS value)
       SELECT community.id
       FROM communities community
       CROSS JOIN query
       WHERE to_tsvector('english',
         coalesce(community.name, '') || ' ' || coalesce(community.field, '') || ' ' ||
         coalesce(community.summary, '') || ' ' || coalesce(community.keywords::text, '')
       ) @@ query.value
       ORDER BY ts_rank_cd(
         to_tsvector('english',
           coalesce(community.name, '') || ' ' || coalesce(community.field, '') || ' ' ||
           coalesce(community.summary, '') || ' ' || coalesce(community.keywords::text, '')
         ),
         query.value
       ) DESC, community.name ASC
       LIMIT $2`,
      [input.query, input.limit]
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
