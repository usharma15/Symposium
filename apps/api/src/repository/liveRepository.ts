import { TRPCError } from "@trpc/server";
import {
  publishNoteInputSchema,
  type PublishNoteInputContract
} from "../../../../packages/contracts/src";
import { getPool, hasDatabase } from "../db/client";
import type { Actor } from "../services/auth";
import { mutationAuditMetadata, stageAuditLog } from "../services/audit";
import { stageEvent } from "../services/events";
import { claimMutation, completeMutation, type MutationContext } from "../services/mutations";
import { runAtomic } from "../services/transactions";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "./foundation";
import { createPost } from "./posts";

export {
  getCommunity,
  getInitialState,
  getPublicCommunity,
  getPublicInitialState,
  listCommunities,
  listPublicCommunities
} from "./foundation";
export { confirmAttachment, createAttachmentUpload } from "./attachments";
export { askAssistant } from "./assistant";
export { addComment, applyCommentAction, deleteComment, updateComment } from "./comments";
export {
  createCommunityCall,
  endCommunityCall,
  joinCommunityCall,
  joinOrRequestCommunity,
  listCommunityCalls
} from "./communities";
export { createOpportunity, listOpportunities } from "./opportunities";
export { listConversations, sendMessage } from "./conversations";
export { listNotifications, markNotificationRead } from "./notifications";
export { applyPostAction, createPost, deletePost, updatePost } from "./posts";
export {
  followProfile,
  listFollowing,
  listProfileActivity,
  listProfileFollows,
  unfollowProfile
} from "./profiles";
export { search } from "./search";
export { getWorkspace, saveNoteBlock } from "./workspace";
export { syncUser, upsertProfile } from "./identity";












export const publishNote = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input: PublishNoteInputContract = publishNoteInputSchema.parse(rawInput);
  const publisher = await ensureProfileHandle(actorHandle(actor));

  if (input.visibility !== "public") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Private and community note publishing require protected post delivery and are not enabled yet."
    });
  }

  let title = input.title;
  let body = input.body;

  if (hasDatabase() && input.noteId) {
    await ensureLiveData();
    const note = await getPool().query<{ title: string; body: string }>(
      `SELECT
         n.title,
         COALESCE(string_agg(nb.body, E'\n\n' ORDER BY nb.sort_order ASC, nb.created_at ASC), '') AS body
       FROM notes n
       JOIN workspaces w ON w.id = n.workspace_id
       LEFT JOIN note_blocks nb ON nb.note_id = n.id
       WHERE n.id = $1 AND w.owner_handle = $2
       GROUP BY n.id`,
      [input.noteId, publisher]
    );

    if (!note.rowCount) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found." });
    title = title ?? note.rows[0]!.title;
    body = body ?? note.rows[0]!.body;
  }

  if (!title || !body) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Publishing requires a noteId or explicit title and body."
    });
  }

  const item = await createPost(
    {
      title,
      body,
      kind: "paper",
      room: "library",
      authorHandle: publisher
    },
    actor,
    mutation ? { ...mutation, scope: "note.publish.post" } : undefined
  );

  const value = {
    item,
    publication: { noteId: input.noteId ?? null, postId: item.id, visibility: input.visibility }
  };
  if (!hasDatabase()) return value;

  return runAtomic(async (client) => {
    const claim = await claimMutation<typeof value>(client, publisher, mutation);
    if (claim.replayed) return { value: claim.response };
    await client.query(
      `INSERT INTO note_publications (note_id, post_id, publisher_handle, visibility, metadata)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (post_id) WHERE post_id IS NOT NULL
       DO UPDATE SET
         note_id = EXCLUDED.note_id,
         publisher_handle = EXCLUDED.publisher_handle,
         visibility = EXCLUDED.visibility,
         metadata = EXCLUDED.metadata`,
      [
        input.noteId ?? null,
        item.id,
        publisher,
        input.visibility,
        JSON.stringify({ source: input.noteId ? "note" : "direct" })
      ]
    );
    await stageAuditLog(client, {
      actorHandle: publisher,
      action: "note.publish",
      subjectType: "post",
      subjectId: item.id,
      metadata: mutationAuditMetadata(mutation, { noteId: input.noteId, visibility: input.visibility })
    });
    await completeMutation(client, publisher, mutation, value);
    const event = await stageEvent(client, {
      kind: "note.published",
      actorHandle: publisher,
      subjectType: "post",
      subjectId: item.id,
      payload: { noteId: input.noteId ?? null, visibility: input.visibility }
    });
    return { value, events: [event] };
  });
};
