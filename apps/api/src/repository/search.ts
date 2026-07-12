import {
  searchInputSchema,
  type ResearchCommunityContract,
  type ResearchProfileContract
} from "../../../../packages/contracts/src";
import { isDeletedPost } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import {
  ensureLiveData,
  json,
  publicCommunity,
  publicProfile,
  rowToItem,
  searchablePostText,
  seedSnapshot,
  type SnapshotRow
} from "./foundation";

export const search = async (rawInput: unknown) => {
  const input = searchInputSchema.parse(rawInput);
  const term = input.query.toLowerCase();

  if (!hasDatabase()) {
    const snapshot = seedSnapshot();
    return {
      posts: snapshot.items
        .filter((item) => !isDeletedPost(item))
        .filter((item) => item.room !== "office" && item.kind !== "draft")
        .filter((item) => searchablePostText({ ...item, authorName: item.author }).toLowerCase().includes(term))
        .map((item) => ({
          ...item,
          saved: false,
          savedBy: [],
          signaledBy: [],
          forkedBy: [],
          comments: []
        }))
        .slice(0, input.limit),
      profiles: Object.values(snapshot.profiles)
        .filter((person) => [person.name, person.handle, person.role, person.location, person.bio, ...person.fields].join(" ").toLowerCase().includes(term))
        .map(publicProfile)
        .slice(0, input.limit),
      communities: (snapshot.communities ?? [])
        .filter((community) => [community.name, community.field, community.summary, ...community.keywords].join(" ").toLowerCase().includes(term))
        .map(publicCommunity)
        .slice(0, input.limit)
    };
  }

  await ensureLiveData();
  const like = `%${input.query}%`;
  const [postsResult, profilesResult, communitiesResult] = await Promise.all([
    getPool().query<SnapshotRow>(
      `SELECT
        id, revision, kind, room, title, author_handle AS "authorHandle", author_name AS "authorName",
        affiliation, date_label AS "dateLabel", status, metrics, gathering_reason AS "gatheringReason",
        created_at AS "createdAt", edited_at AS "editedAt", deleted_at AS "deletedAt",
        excerpt, body, tags, signals, claims, objections, evidence, tests, forks, saved,
        saved_by AS "savedBy", signaled_by AS "signaledBy", forked_by AS "forkedBy", quote
       FROM posts
       WHERE search_text ILIKE $1
         AND deleted_at IS NULL
         AND room <> 'office'
         AND kind <> 'draft'
       ORDER BY created_at DESC
       LIMIT $2`,
      [like, input.limit]
    ),
    getPool().query<ResearchProfileContract>(
      `SELECT handle, name, avatar_url AS "avatarUrl", likes_public AS "likesPublic",
        reshares_public AS "resharesPublic", role, location, bio, fields, revision
       FROM profiles
       WHERE name ILIKE $1 OR handle ILIKE $1 OR role ILIKE $1 OR location ILIKE $1 OR bio ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [like, input.limit]
    ),
    getPool().query<ResearchCommunityContract>(
      `SELECT id, name, field, summary, visibility, online, member_handles AS "memberHandles",
        keywords, seed_counts AS "seedCounts", call_status AS "callStatus"
       FROM communities
       WHERE name ILIKE $1 OR field ILIKE $1 OR summary ILIKE $1
       ORDER BY name ASC
       LIMIT $2`,
      [like, input.limit]
    )
  ]);

  return {
    posts: postsResult.rows.map((row) => ({
      ...rowToItem(row, []),
      saved: false,
      savedBy: [],
      signaledBy: [],
      forkedBy: []
    })),
    profiles: profilesResult.rows.map((person) => publicProfile({ ...person, fields: json(person.fields, []) })),
    communities: communitiesResult.rows.map((community) =>
      publicCommunity({
        ...community,
        memberHandles: json(community.memberHandles, []),
        keywords: json(community.keywords, []),
        seedCounts: json(community.seedCounts, { papers: 0, thoughts: 0, opportunities: 0 })
      })
    )
  };
};
