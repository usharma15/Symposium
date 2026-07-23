import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withReadActor, withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import { mutationContextFromRequest } from "../services/mutations";
import {
  askAssistant,
  getAssistantConversation,
  getAssistantQuota,
  listAssistantConversations,
  updateAssistantConversationContext
} from "../repository/assistant";
import { translateDocument } from "../repository/documentTranslations";
import { createOpportunity, listOpportunities } from "../repository/opportunities";
import { saveNoteBlock } from "../repository/workspace";
import {
  createWorkspaceGrant,
  deleteWorkspaceGrant,
  getWorkspaceAccess,
  searchWorkspaceCollaborators,
  updateWorkspaceGrant
} from "../repository/workspaceAccess";
import {
  assertWorkspaceAttachmentAccess,
  createWorkspaceDocument,
  createWorkspaceNotebook,
  deleteWorkspaceDocument,
  deleteWorkspaceNotebook,
  getWorkspaceDocuments,
  searchWorkspaceDocuments,
  updateWorkspaceDocument,
  updateWorkspaceNotebook
} from "../repository/workspaceDocuments";
import {
  applyWorkspaceCommentAction,
  createWorkspaceComment,
  deleteWorkspaceComment,
  getWorkspaceComments,
  updateWorkspaceComment
} from "../repository/workspaceComments";
import {
  createAssistantQuickNote,
  discardScribble,
  fileScribble,
  getScribble,
  restoreScribble,
  updateScribble
} from "../repository/workspaceScribbles";
import { publishNote } from "../services/notePublishing";
import { createPrivateDownloadUrl } from "../services/storage";
import type { RouteParams } from "./types";

export const registerWorkspaceRoutes = (app: FastifyInstance) => {
  app.get("/v1/opportunities", async (request, reply) => {
    try {
      const opportunities = await listOpportunities(request.query);
      return reply.send({ opportunities });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/opportunities", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const opportunity = await createOpportunity(
        request.body,
        actor,
        mutationContextFromRequest(request, "opportunity.create", request.body)
      );
      return reply.send({ opportunity });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/workspace", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const workspace = await getWorkspaceDocuments(actor);
      return reply.send(workspace);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/workspace/scribble", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await getScribble(actor));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch("/v1/workspace/scribble", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await updateScribble(
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.scribble.update", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/workspace/scribble/file", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await fileScribble(
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.scribble.file", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/workspace/scribble/discard", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await discardScribble(
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.scribble.discard", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/workspace/scribble/restore", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await restoreScribble(
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.scribble.restore", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/workspace/documents", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const result = await createWorkspaceDocument(
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.document.create", request.body)
      );
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: { noteId: string } }>("/v1/workspace/documents/:noteId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const result = await updateWorkspaceDocument(
        request.params.noteId,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.document.update", request.body)
      );
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: { noteId: string } }>("/v1/workspace/documents/:noteId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const result = await deleteWorkspaceDocument(
        request.params.noteId,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.document.delete", request.body)
      );
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: { noteId: string } }>("/v1/workspace/documents/:noteId/access", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await getWorkspaceAccess("document", request.params.noteId, actor));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: { noteId: string } }>("/v1/workspace/documents/:noteId/access", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await createWorkspaceGrant(
        "document",
        request.params.noteId,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.document.access.grant", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: { noteId: string; granteeHandle: string } }>("/v1/workspace/documents/:noteId/access/:granteeHandle", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await updateWorkspaceGrant(
        "document",
        request.params.noteId,
        request.params.granteeHandle,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.document.access.update", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: { noteId: string; granteeHandle: string } }>("/v1/workspace/documents/:noteId/access/:granteeHandle", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await deleteWorkspaceGrant(
        "document",
        request.params.noteId,
        request.params.granteeHandle,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.document.access.revoke", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: { noteId: string } }>("/v1/workspace/documents/:noteId/comments", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await getWorkspaceComments(request.params.noteId, actor));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: { noteId: string } }>("/v1/workspace/documents/:noteId/comments", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await createWorkspaceComment(
        request.params.noteId,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.comment.create", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: { noteId: string; commentId: string } }>("/v1/workspace/documents/:noteId/comments/:commentId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await updateWorkspaceComment(
        request.params.noteId,
        request.params.commentId,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.comment.update", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: { noteId: string; commentId: string } }>("/v1/workspace/documents/:noteId/comments/:commentId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await deleteWorkspaceComment(
        request.params.noteId,
        request.params.commentId,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.comment.delete", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: { noteId: string; commentId: string } }>("/v1/workspace/documents/:noteId/comments/:commentId/actions", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await applyWorkspaceCommentAction(
        request.params.noteId,
        request.params.commentId,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.comment.action", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/workspace/notebooks", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await createWorkspaceNotebook(
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.notebook.create", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: { notebookId: string } }>("/v1/workspace/notebooks/:notebookId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await updateWorkspaceNotebook(
        request.params.notebookId,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.notebook.update", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: { notebookId: string } }>("/v1/workspace/notebooks/:notebookId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await deleteWorkspaceNotebook(
        request.params.notebookId,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.notebook.delete", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: { notebookId: string } }>("/v1/workspace/notebooks/:notebookId/access", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await getWorkspaceAccess("notebook", request.params.notebookId, actor));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: { notebookId: string } }>("/v1/workspace/notebooks/:notebookId/access", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await createWorkspaceGrant(
        "notebook",
        request.params.notebookId,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.notebook.access.grant", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: { notebookId: string; granteeHandle: string } }>("/v1/workspace/notebooks/:notebookId/access/:granteeHandle", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await updateWorkspaceGrant(
        "notebook",
        request.params.notebookId,
        request.params.granteeHandle,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.notebook.access.update", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: { notebookId: string; granteeHandle: string } }>("/v1/workspace/notebooks/:notebookId/access/:granteeHandle", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await deleteWorkspaceGrant(
        "notebook",
        request.params.notebookId,
        request.params.granteeHandle,
        request.body,
        actor,
        mutationContextFromRequest(request, "workspace.notebook.access.revoke", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/workspace/collaborators", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await searchWorkspaceCollaborators(request.query, actor));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/workspace/search", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await searchWorkspaceDocuments(request.query, actor));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: { attachmentId: string } }>("/v1/workspace/attachments/:attachmentId/access", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const attachment = await assertWorkspaceAttachmentAccess(request.params.attachmentId, actor);
      return reply.send({ url: await createPrivateDownloadUrl(attachment.objectKey) });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/notes/blocks", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const block = await saveNoteBlock(
        request.body,
        actor,
        mutationContextFromRequest(request, "note.block.save", request.body)
      );
      return reply.send({ block });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/notes/publish", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const publication = await publishNote(
        request.body,
        actor,
        mutationContextFromRequest(request, "note.publish", request.body)
      );
      return reply.send(publication);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/assistant/quota", async (request, reply) => {
    try {
      return reply.send(await getAssistantQuota(await withReadActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/assistant/conversations", async (request, reply) => {
    try {
      return reply.send(await listAssistantConversations(request.query, await withReadActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams }>("/v1/assistant/conversations/:id", async (request, reply) => {
    try {
      return reply.send(await getAssistantConversation(
        z.string().uuid().parse(request.params.id),
        await withReadActor(request)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/assistant/conversations/:id/context", async (request, reply) => {
    try {
      const conversationId = z.string().uuid().parse(request.params.id);
      return reply.send(await updateAssistantConversationContext(
        conversationId,
        request.body,
        await withWriteActor(request, { shared: true, scope: "assistant-action", limit: 30 }),
        mutationContextFromRequest(request, "assistant.context.update", { conversationId, body: request.body })
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/assistant/messages", async (request, reply) => {
    try {
      const actor = await withWriteActor(request, { shared: true, scope: "assistant", limit: 10 });
      const response = await askAssistant(
        request.body,
        actor,
        mutationContextFromRequest(request, "assistant.message", request.body)
      );
      return reply.send(response);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/assistant/document-translations", async (request, reply) => {
    try {
      const actor = await withWriteActor(request, { shared: true, scope: "assistant", limit: 10 });
      const response = await translateDocument(
        request.body,
        actor,
        mutationContextFromRequest(request, "assistant.document-translation", request.body)
      );
      return reply.send(response);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/assistant/quick-notes", async (request, reply) => {
    try {
      const actor = await withWriteActor(request, { shared: true, scope: "assistant-action", limit: 30 });
      return reply.send(await createAssistantQuickNote(
        request.body,
        actor,
        mutationContextFromRequest(request, "assistant.quick-note.create", request.body)
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
