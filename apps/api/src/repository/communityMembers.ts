import {
  communityMemberQuerySchema,
  joinCommunityInputSchema,
  type CommunityMemberContract,
  type CommunityMemberPageContract
} from "../../../../packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { assertCommunityReadAccess } from "./communities";
import { actorHandle, ensureLiveData, ensureProfileHandle, seedSnapshot } from "./foundation";

export const recordCommunityAccess = async (rawInput: unknown, actor: Actor) => {
  const input = joinCommunityInputSchema.parse(rawInput);
  const handle = await ensureProfileHandle(actorHandle(actor));
  await assertCommunityReadAccess(input.communityId, handle);
  const accessedAt = new Date().toISOString();
  if (!hasDatabase()) return { communityId: input.communityId, accessedAt };
  await ensureLiveData();
  await getPool().query(
    `UPDATE community_memberships
     SET last_accessed_at = $3, updated_at = now()
     WHERE community_id = $1 AND profile_handle = $2 AND status = 'active'`,
    [input.communityId, handle, accessedAt]
  );
  return { communityId: input.communityId, accessedAt };
};

const encodeMemberCursor = (joinedAt: string, handle: string) =>
  Buffer.from(JSON.stringify({ joinedAt, handle })).toString("base64url");

const decodeMemberCursor = (cursor?: string) => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { joinedAt?: unknown; handle?: unknown };
    if (typeof parsed.joinedAt !== "string" || typeof parsed.handle !== "string" || Number.isNaN(Date.parse(parsed.joinedAt))) return null;
    return { joinedAt: parsed.joinedAt, handle: cleanHandle(parsed.handle) };
  } catch {
    return null;
  }
};

export const listCommunityMembers = async (communityId: string, actor: Actor, rawQuery: unknown): Promise<CommunityMemberPageContract> => {
  const query = communityMemberQuerySchema.parse(rawQuery);
  const community = await assertCommunityReadAccess(communityId, actor.handle);
  const cursor = decodeMemberCursor(query.cursor);
  const roleMatches = (role: string) => query.role === "all" || role === "owner" || role === "moderator";
  if (!hasDatabase()) {
    const profiles = seedSnapshot().profiles;
    const owner = cleanHandle(community.ownerHandle ?? community.memberHandles[0] ?? "");
    const moderators = new Set((community.moderatorHandles ?? []).map(cleanHandle));
    const term = query.q.toLowerCase();
    const visible = community.memberHandles.map((rawHandle, index) => {
      const handle = cleanHandle(rawHandle);
      const person = profiles[handle];
      const role = handle === owner ? "owner" as const : moderators.has(handle) ? "moderator" as const : "member" as const;
      return {
        handle,
        name: person?.name ?? handle.replace(/^@/, "").replace(/[_-]+/g, " "),
        avatarUrl: person?.avatarUrl,
        role,
        joinedAt: new Date(Date.UTC(2026, 6, 15 - Math.floor(index / 18), 18, index % 60)).toISOString()
      };
    }).filter((member) => roleMatches(member.role))
      .filter((member) => !term || `${member.name} ${member.handle}`.toLowerCase().includes(term))
      .sort((first, second) => second.joinedAt.localeCompare(first.joinedAt) || second.handle.localeCompare(first.handle));
    const total = visible.length;
    const afterCursor = cursor
      ? visible.filter((member) => member.joinedAt < cursor.joinedAt || (member.joinedAt === cursor.joinedAt && member.handle < cursor.handle))
      : visible;
    const page = afterCursor.slice(0, query.limit);
    const last = page.at(-1);
    return { members: page, nextCursor: afterCursor.length > page.length && last ? encodeMemberCursor(last.joinedAt, last.handle) : null, total };
  }

  await ensureLiveData();
  const values = [community.id, query.q, query.role, cursor?.joinedAt ?? null, cursor?.handle ?? null, query.limit + 1];
  const [members, count] = await Promise.all([
    getPool().query<CommunityMemberContract & { avatarUrl: string | null }>(
      `SELECT
         membership.profile_handle AS handle,
         profile.name,
         profile.avatar_url AS "avatarUrl",
         membership.role,
         membership.created_at AS "joinedAt"
       FROM community_memberships membership
       JOIN profiles profile ON profile.handle = membership.profile_handle
       WHERE membership.community_id = $1
         AND membership.status = 'active'
         AND ($3 = 'all' OR membership.role IN ('owner', 'moderator'))
         AND ($2 = '' OR profile.name ILIKE '%' || $2 || '%' OR profile.handle ILIKE '%' || $2 || '%')
         AND ($4::timestamptz IS NULL OR (membership.created_at, membership.profile_handle) < ($4::timestamptz, $5::text))
       ORDER BY membership.created_at DESC, membership.profile_handle DESC
       LIMIT $6`,
      values
    ),
    getPool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM community_memberships membership
       JOIN profiles profile ON profile.handle = membership.profile_handle
       WHERE membership.community_id = $1
         AND membership.status = 'active'
         AND ($3 = 'all' OR membership.role IN ('owner', 'moderator'))
         AND ($2 = '' OR profile.name ILIKE '%' || $2 || '%' OR profile.handle ILIKE '%' || $2 || '%')`,
      values.slice(0, 3)
    )
  ]);
  const page = members.rows.slice(0, query.limit).map((member) => ({
    ...member,
    avatarUrl: member.avatarUrl ?? undefined,
    role: member.role === "owner" || member.role === "moderator" ? member.role : "member" as const,
    joinedAt: new Date(member.joinedAt).toISOString()
  }));
  const last = page.at(-1);
  return {
    members: page,
    nextCursor: members.rows.length > query.limit && last ? encodeMemberCursor(last.joinedAt, last.handle) : null,
    total: Number(count.rows[0]?.total ?? 0)
  };
};
