import { TRPCError } from "@trpc/server";
import {
  documentFitsReducedEditor,
  publishNoteInputSchema,
  versionedDocumentSchema,
  type PublishNoteInputContract
} from "../../../../packages/contracts/src";
import { hasDatabase } from "../db/client";
import { addComment } from "../repository/comments";
import { actorHandle, ensureLiveData, ensureProfileHandle } from "../repository/foundation";
import { createPost } from "../repository/posts";
import type { Actor } from "./auth";
import type { MutationContext } from "./mutations";
import { prepareWorkspacePublicationAttachments } from "./workspaceAttachmentPublishing";
import { prepareWorkspaceDiscussionPublication } from "./workspaceDiscussionPublishing";
import {
  assertWorkspaceRevisionNotPublished,
  loadPublishableWorkspaceRevision,
  persistWorkspacePublication,
  withWorkspacePublicationLock,
  type PublishableWorkspaceRevision
} from "./workspacePublicationState";

const publicationTarget = (revision: PublishableWorkspaceRevision, input: PublishNoteInputContract) => {
  if (revision.kind === "paper") {
    return revision.publicationTarget === "proposal" ? "proposal" as const : "paper" as const;
  }
  if (revision.kind === "thought") return "thought" as const;
  if (revision.kind === "comment") return "comment" as const;
  if (revision.kind === "reply") return "reply" as const;
  if (revision.kind === "note") {
    const target = input.publicationTarget ?? revision.publicationTarget;
    if (target === "paper" || target === "thought") return target;
    throw new TRPCError({ code: "BAD_REQUEST", message: "Choose whether this generic note becomes a Paper or a Thought." });
  }
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Develop this Quick Note into a Note or Paper before publishing it." });
};

export const publishNote = async (rawInput: unknown, actor: Actor, mutation?: MutationContext) => {
  const input: PublishNoteInputContract = publishNoteInputSchema.parse(rawInput);
  const publisher = await ensureProfileHandle(actorHandle(actor));

  if (input.visibility !== "public") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "A workspace draft stays private until it is published to a public destination."
    });
  }

  if (!hasDatabase() || !input.noteId) {
    if (!input.title || !input.body) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Publishing requires a draft or explicit title and body." });
    }
    if (input.publicationTarget === "proposal") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Publish a Patronage Proposal from its exact Workspace draft revision."
      });
    }
    const item = await createPost(
      {
        title: input.title,
        body: input.body,
        kind: input.publicationTarget ?? "paper",
        room: input.publicationTarget === "thought" ? "amphitheater" : "library",
        authorHandle: publisher
      },
      actor,
      mutation ? { ...mutation, scope: "note.publish.post" } : undefined
    );
    return { item, publication: { noteId: null, postId: item.id, visibility: "public" as const } };
  }

  await ensureLiveData();
  return withWorkspacePublicationLock(input.noteId, publisher, mutation, async (client) => {
    const revision = await loadPublishableWorkspaceRevision(client, input.noteId!, input.expectedRevision, publisher);
    await assertWorkspaceRevisionNotPublished(client, revision);
    const target = publicationTarget(revision, input);
    const document = versionedDocumentSchema.parse(revision.document);
    const discussion = await prepareWorkspaceDiscussionPublication(client, {
      noteId: revision.noteId,
      revision: revision.revision,
      ownerHandle: revision.ownerHandle
    });
    if (target !== "paper" && target !== "proposal" && !documentFitsReducedEditor(document)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This draft uses Paper formatting and cannot be published to a reduced editor destination."
      });
    }

    if (target === "paper" || target === "thought" || target === "proposal") {
      if (target === "proposal" && !revision.proposal) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Add funding details before publishing this Patronage Proposal." });
      }
      const publishedContent = await prepareWorkspacePublicationAttachments(client, {
        noteId: revision.noteId,
        revision: revision.revision,
        attachmentIds: revision.attachmentIds,
        document,
        ownerType: "post",
        uploaderHandle: revision.ownerHandle
      });
      const ownerActor: Actor = { ...actor, handle: revision.ownerHandle };
      const item = await createPost(
        {
          title: revision.title,
          body: revision.body,
          document: publishedContent.document,
          kind: target === "proposal" ? "paper" : target,
          room: target === "proposal" ? "funding" : target === "paper" ? "library" : "amphitheater",
          patronage: target === "proposal" ? revision.proposal ?? undefined : undefined,
          authorHandle: revision.ownerHandle,
          attachmentIds: publishedContent.attachmentIds
        },
        ownerActor,
        mutation ? { ...mutation, scope: "note.publish.post" } : undefined
      );
      return persistWorkspacePublication(revision, publisher, target, { item }, discussion, mutation);
    }

    const targetId = revision.targetId?.trim();
    if (!targetId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Choose the post this comment draft belongs to before publishing." });
    }
    const separator = targetId.indexOf(":");
    const postId = target === "reply" && separator > 0 ? targetId.slice(0, separator) : targetId;
    const parentId = target === "reply" && separator > 0 ? targetId.slice(separator + 1) : null;
    if (target === "reply" && !parentId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "A reply draft must be linked as post-id:comment-id." });
    }
    const publishedContent = await prepareWorkspacePublicationAttachments(client, {
      noteId: revision.noteId,
      revision: revision.revision,
      attachmentIds: revision.attachmentIds,
      document,
      ownerType: "comment",
      uploaderHandle: revision.ownerHandle
    });
    const ownerActor: Actor = { ...actor, handle: revision.ownerHandle };
    const commentResult = await addComment(
      postId,
      {
        body: revision.body,
        document: publishedContent.document,
        stance: revision.title,
        parentId,
        attachmentIds: publishedContent.attachmentIds,
        authorHandle: revision.ownerHandle
      },
      ownerActor,
      mutation ? { ...mutation, scope: "note.publish.comment" } : undefined
    );
    return persistWorkspacePublication(revision, publisher, target, commentResult, discussion, mutation);
  });
};
