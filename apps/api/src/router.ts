import { z } from "zod";
import {
  assistantMessageInputSchema,
  callIdInputSchema,
  confirmAttachmentInputSchema,
  createCommunityInputSchema,
  createAttachmentUploadInputSchema,
  createCommentInputSchema,
  createCommunityCallInputSchema,
  createOpportunityInputSchema,
  createPostInputSchema,
  createProfileInputSchema,
  createWorkspaceDocumentInputSchema,
  createWorkspaceCommentInputSchema,
  createWorkspaceNotebookInputSchema,
  deleteWorkspaceDocumentInputSchema,
  deleteWorkspaceCommentInputSchema,
  deleteWorkspaceNotebookInputSchema,
  followProfileInputSchema,
  joinCommunityInputSchema,
  markNotificationInputSchema,
  postActionInputSchema,
  publishNoteInputSchema,
  saveNoteBlockInputSchema,
  searchInputSchema,
  sendMessageInputSchema,
  updateWorkspaceDocumentInputSchema,
  updateWorkspaceCommentInputSchema,
  updateWorkspaceNotebookInputSchema,
  unfollowProfileInputSchema,
  workspaceSearchInputSchema,
  workspaceCommentActionInputSchema
} from "../../../packages/contracts/src";
import { askAssistant } from "./repository/assistant";
import { confirmAttachment, createAttachmentUpload } from "./repository/attachments";
import { addComment } from "./repository/comments";
import {
  createCommunityCall,
  createCommunity,
  endCommunityCall,
  joinCommunityCall,
  joinOrRequestCommunity,
  leaveCommunity,
  listCommunityCalls
} from "./repository/communities";
import { recordCommunityAccess } from "./repository/communityMembers";
import { listConversations, sendMessage } from "./repository/conversations";
import {
  getInitialState,
  getPublicCommunity,
  getPublicInitialState,
  listPublicCommunities
} from "./repository/foundation";
import { syncUser, upsertProfile } from "./repository/identity";
import { listNotifications, markNotificationRead } from "./repository/notifications";
import { createOpportunity, listOpportunities } from "./repository/opportunities";
import { applyPostAction, createPost } from "./repository/posts";
import { followProfile, listFollowing, unfollowProfile } from "./repository/profiles";
import { search } from "./repository/search";
import { saveNoteBlock } from "./repository/workspace";
import {
  createWorkspaceDocument,
  createWorkspaceNotebook,
  deleteWorkspaceDocument,
  deleteWorkspaceNotebook,
  getWorkspaceDocuments,
  searchWorkspaceDocuments,
  updateWorkspaceDocument,
  updateWorkspaceNotebook
} from "./repository/workspaceDocuments";
import {
  applyWorkspaceCommentAction,
  createWorkspaceComment,
  deleteWorkspaceComment,
  getWorkspaceComments,
  updateWorkspaceComment
} from "./repository/workspaceComments";
import { publishNote } from "./services/notePublishing";
import { authedProcedure, publicProcedure, router } from "./trpc";
import { mutationContextFromRequest } from "./services/mutations";

export const appRouter = router({
  auth: router({
    syncUser: authedProcedure.mutation(({ ctx, input }) => syncUser(input, ctx.actor))
  }),
  bootstrap: router({
    getInitialState: publicProcedure.query(({ ctx }) => getPublicInitialState(ctx.actor.handle))
  }),
  profiles: router({
    getMe: authedProcedure.query(async ({ ctx }) => {
      const snapshot = await getInitialState();
      return ctx.actor.handle ? snapshot.profiles[ctx.actor.handle] ?? null : null;
    }),
    update: authedProcedure.input(createProfileInputSchema).mutation(({ ctx, input }) => upsertProfile(input, ctx.actor)),
    follow: authedProcedure.input(followProfileInputSchema).mutation(({ ctx, input }) => followProfile(input, ctx.actor)),
    unfollow: authedProcedure.input(unfollowProfileInputSchema).mutation(({ ctx, input }) => unfollowProfile(input, ctx.actor)),
    following: authedProcedure.query(({ ctx }) => listFollowing(ctx.actor))
  }),
  posts: router({
    getFeed: publicProcedure
      .input(z.object({ room: z.string().optional(), limit: z.number().int().positive().max(100).default(50) }).optional())
      .query(async ({ ctx, input }) => {
        const snapshot = await getPublicInitialState(ctx.actor.handle);
        const externallyDiscoverable = snapshot.items.filter((item) => !item.communityId || item.postType === "paper");
        const items = input?.room ? externallyDiscoverable.filter((item) => item.room === input.room) : externallyDiscoverable;
        return items.slice(0, input?.limit ?? 50);
      }),
    getDetail: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
      const snapshot = await getPublicInitialState(ctx.actor.handle);
      return snapshot.items.find((item) => item.id === input.id) ?? null;
    }),
    create: authedProcedure.input(createPostInputSchema).mutation(({ ctx, input }) =>
      createPost(input, ctx.actor, mutationContextFromRequest(ctx.req, "post.create", input))
    ),
    react: authedProcedure.input(z.object({ postId: z.string() }).merge(postActionInputSchema)).mutation(({ ctx, input }) =>
      applyPostAction(
        input.postId,
        input,
        ctx.actor,
        mutationContextFromRequest(ctx.req, "post.action", input)
      )
    ),
    save: authedProcedure.input(z.object({ postId: z.string(), actorHandle: z.string().optional(), active: z.boolean().optional() })).mutation(({ ctx, input }) =>
      applyPostAction(
        input.postId,
        { action: "save", actorHandle: input.actorHandle, active: input.active },
        ctx.actor,
        mutationContextFromRequest(ctx.req, "post.action", { ...input, action: "save" })
      )
    )
  }),
  comments: router({
    list: publicProcedure.input(z.object({ postId: z.string() })).query(async ({ ctx, input }) => {
      const snapshot = await getPublicInitialState(ctx.actor.handle);
      return snapshot.items.find((item) => item.id === input.postId)?.comments ?? [];
    }),
    create: authedProcedure.input(z.object({ postId: z.string() }).merge(createCommentInputSchema)).mutation(({ ctx, input }) =>
      addComment(
        input.postId,
        input,
        ctx.actor,
        mutationContextFromRequest(ctx.req, "comment.create", input)
      )
    )
  }),
  communities: router({
    list: publicProcedure.query(({ ctx }) => listPublicCommunities(ctx.actor.handle)),
    get: publicProcedure.input(z.object({ communityId: z.string() })).query(({ ctx, input }) => getPublicCommunity(input.communityId, ctx.actor.handle)),
    create: authedProcedure.input(createCommunityInputSchema).mutation(({ ctx, input }) =>
      createCommunity(input, ctx.actor, mutationContextFromRequest(ctx.req, "community.create", input))
    ),
    joinOrRequest: authedProcedure.input(joinCommunityInputSchema).mutation(({ ctx, input }) => joinOrRequestCommunity(input, ctx.actor)),
    leave: authedProcedure.input(joinCommunityInputSchema).mutation(({ ctx, input }) => leaveCommunity(input, ctx.actor)),
    recordAccess: authedProcedure.input(joinCommunityInputSchema).mutation(({ ctx, input }) => recordCommunityAccess(input, ctx.actor)),
    listCalls: publicProcedure.input(z.object({ communityId: z.string() })).query(({ ctx, input }) =>
      listCommunityCalls(input.communityId, ctx.actor)
    ),
    createCall: authedProcedure.input(createCommunityCallInputSchema).mutation(({ ctx, input }) =>
      createCommunityCall(
        input,
        ctx.actor,
        mutationContextFromRequest(ctx.req, "community.call.create", input)
      )
    ),
    joinCall: authedProcedure.input(callIdInputSchema).mutation(({ ctx, input }) => joinCommunityCall(input, ctx.actor)),
    endCall: authedProcedure.input(callIdInputSchema).mutation(({ ctx, input }) => endCommunityCall(input, ctx.actor))
  }),
  attachments: router({
    createUpload: authedProcedure.input(createAttachmentUploadInputSchema).mutation(({ ctx, input }) =>
      createAttachmentUpload(
        input,
        ctx.actor,
        mutationContextFromRequest(ctx.req, "attachment.prepare", input)
      )
    ),
    confirmUpload: authedProcedure.input(confirmAttachmentInputSchema).mutation(({ ctx, input }) => confirmAttachment(input, ctx.actor))
  }),
  opportunities: router({
    list: publicProcedure.input(createOpportunityInputSchema.partial().optional()).query(({ input }) => listOpportunities(input)),
    create: authedProcedure.input(createOpportunityInputSchema).mutation(({ ctx, input }) =>
      createOpportunity(input, ctx.actor, mutationContextFromRequest(ctx.req, "opportunity.create", input))
    )
  }),
  search: router({
    query: publicProcedure.input(searchInputSchema).query(({ ctx, input }) => search(input, ctx.actor.handle))
  }),
  notifications: router({
    list: authedProcedure.query(({ ctx }) => listNotifications(ctx.actor)),
    markRead: authedProcedure.input(markNotificationInputSchema).mutation(({ ctx, input }) => markNotificationRead(input, ctx.actor))
  }),
  messages: router({
    listConversations: authedProcedure.query(({ ctx }) => listConversations(ctx.actor)),
    send: authedProcedure.input(sendMessageInputSchema).mutation(({ ctx, input }) =>
      sendMessage(input, ctx.actor, mutationContextFromRequest(ctx.req, "message.send", input))
    )
  }),
  notes: router({
    getWorkspace: authedProcedure.query(({ ctx }) => getWorkspaceDocuments(ctx.actor)),
    createDocument: authedProcedure.input(createWorkspaceDocumentInputSchema).mutation(({ ctx, input }) =>
      createWorkspaceDocument(input, ctx.actor, mutationContextFromRequest(ctx.req, "workspace.document.create", input))
    ),
    updateDocument: authedProcedure
      .input(z.object({ noteId: z.string().uuid(), input: updateWorkspaceDocumentInputSchema }))
      .mutation(({ ctx, input }) =>
        updateWorkspaceDocument(input.noteId, input.input, ctx.actor, mutationContextFromRequest(ctx.req, "workspace.document.update", input.input))
      ),
    deleteDocument: authedProcedure
      .input(z.object({ noteId: z.string().uuid(), input: deleteWorkspaceDocumentInputSchema }))
      .mutation(({ ctx, input }) =>
        deleteWorkspaceDocument(input.noteId, input.input, ctx.actor, mutationContextFromRequest(ctx.req, "workspace.document.delete", input.input))
      ),
    getComments: authedProcedure.input(z.object({ noteId: z.string().uuid() })).query(({ ctx, input }) =>
      getWorkspaceComments(input.noteId, ctx.actor)
    ),
    createComment: authedProcedure
      .input(z.object({ noteId: z.string().uuid(), input: createWorkspaceCommentInputSchema }))
      .mutation(({ ctx, input }) =>
        createWorkspaceComment(input.noteId, input.input, ctx.actor, mutationContextFromRequest(ctx.req, "workspace.comment.create", input.input))
      ),
    updateComment: authedProcedure
      .input(z.object({ noteId: z.string().uuid(), commentId: z.string().uuid(), input: updateWorkspaceCommentInputSchema }))
      .mutation(({ ctx, input }) =>
        updateWorkspaceComment(input.noteId, input.commentId, input.input, ctx.actor, mutationContextFromRequest(ctx.req, "workspace.comment.update", input.input))
      ),
    deleteComment: authedProcedure
      .input(z.object({ noteId: z.string().uuid(), commentId: z.string().uuid(), input: deleteWorkspaceCommentInputSchema }))
      .mutation(({ ctx, input }) =>
        deleteWorkspaceComment(input.noteId, input.commentId, input.input, ctx.actor, mutationContextFromRequest(ctx.req, "workspace.comment.delete", input.input))
      ),
    commentAction: authedProcedure
      .input(z.object({ noteId: z.string().uuid(), commentId: z.string().uuid(), input: workspaceCommentActionInputSchema }))
      .mutation(({ ctx, input }) =>
        applyWorkspaceCommentAction(input.noteId, input.commentId, input.input, ctx.actor, mutationContextFromRequest(ctx.req, "workspace.comment.action", input.input))
      ),
    createNotebook: authedProcedure.input(createWorkspaceNotebookInputSchema).mutation(({ ctx, input }) =>
      createWorkspaceNotebook(input, ctx.actor, mutationContextFromRequest(ctx.req, "workspace.notebook.create", input))
    ),
    updateNotebook: authedProcedure
      .input(z.object({ notebookId: z.string().uuid(), input: updateWorkspaceNotebookInputSchema }))
      .mutation(({ ctx, input }) =>
        updateWorkspaceNotebook(input.notebookId, input.input, ctx.actor, mutationContextFromRequest(ctx.req, "workspace.notebook.update", input.input))
      ),
    deleteNotebook: authedProcedure
      .input(z.object({ notebookId: z.string().uuid(), input: deleteWorkspaceNotebookInputSchema }))
      .mutation(({ ctx, input }) =>
        deleteWorkspaceNotebook(input.notebookId, input.input, ctx.actor, mutationContextFromRequest(ctx.req, "workspace.notebook.delete", input.input))
      ),
    searchWorkspace: authedProcedure.input(workspaceSearchInputSchema).query(({ ctx, input }) =>
      searchWorkspaceDocuments(input, ctx.actor)
    ),
    saveBlock: authedProcedure.input(saveNoteBlockInputSchema).mutation(({ ctx, input }) =>
      saveNoteBlock(input, ctx.actor, mutationContextFromRequest(ctx.req, "note.block.save", input))
    ),
    publish: authedProcedure.input(publishNoteInputSchema).mutation(({ ctx, input }) =>
      publishNote(input, ctx.actor, mutationContextFromRequest(ctx.req, "note.publish", input))
    )
  }),
  assistant: router({
    ask: authedProcedure.input(assistantMessageInputSchema).mutation(({ ctx, input }) =>
      askAssistant(input, ctx.actor, mutationContextFromRequest(ctx.req, "assistant.message", input))
    )
  })
});

export type AppRouter = typeof appRouter;
