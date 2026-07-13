import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import { mutationContextFromRequest } from "../services/mutations";
import { askAssistant } from "../repository/assistant";
import { listConversations, sendMessage } from "../repository/conversations";
import { listNotifications } from "../repository/notifications";
import { createOpportunity, listOpportunities } from "../repository/opportunities";
import { saveNoteBlock } from "../repository/workspace";
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
import { publishNote } from "../services/notePublishing";
import { createPrivateDownloadUrl } from "../services/storage";

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

  app.get("/v1/conversations", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const conversations = await listConversations(actor);
      return reply.send({ conversations });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/messages", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const message = await sendMessage(
        request.body,
        actor,
        mutationContextFromRequest(request, "message.send", request.body)
      );
      return reply.send({ message });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/notifications", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const notifications = await listNotifications(actor);
      return reply.send({ notifications });
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

  app.post("/v1/assistant/messages", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
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
};
