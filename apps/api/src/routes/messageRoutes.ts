import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import {
  addConversationParticipants,
  assertMessageAttachmentAccess,
  clearConversation,
  createGroupConversation,
  deleteConversationForViewer,
  deleteMessage,
  editMessage,
  getConversation,
  getMessageContext,
  getUnreadMessageCount,
  inviteConversationParticipants,
  leaveConversation,
  listConversations,
  listMessages,
  listStarredMessages,
  markConversationRead,
  removeConversationParticipant,
  resolveConversationInvite,
  saveConversationDraft,
  searchConversation,
  sendMessage,
  setProfileBlock,
  starMessage,
  updateConversationParticipant,
  updateConversationPreferences
} from "../repository/conversations";
import { listNotifications, markNotificationRead } from "../repository/notifications";
import { mutationContextFromRequest } from "../services/mutations";
import { createPrivateDownloadUrl } from "../services/storage";
import type { RouteParams } from "./types";

type MessageParams = RouteParams & { messageId: string };
type ParticipantParams = RouteParams & { handle: string };
type AttachmentParams = { attachmentId: string };
type Query = Record<string, string | undefined>;
const uuidParam = (value: string) => z.string().uuid().parse(value);
const handleParam = (value: string) => z.string().trim().min(1).max(80).parse(value);

export const registerMessageRoutes = (app: FastifyInstance) => {
  app.get<{ Querystring: Query }>("/v1/conversations", async (request, reply) => {
    try {
      return reply.send(await listConversations(request.query, await withWriteActor(request, { scope: "message-read", limit: 180 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/conversations/unread", async (request, reply) => {
    try {
      return reply.send(await getUnreadMessageCount(await withWriteActor(request, { scope: "message-unread", limit: 180 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams }>("/v1/conversations/:id", async (request, reply) => {
    try {
      return reply.send({ conversation: await getConversation(uuidParam(request.params.id), await withWriteActor(request, { scope: "message-read", limit: 180 })) });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams; Querystring: Query }>("/v1/conversations/:id/messages", async (request, reply) => {
    try {
      return reply.send(await listMessages(uuidParam(request.params.id), request.query, await withWriteActor(request, { scope: "message-read", limit: 180 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: MessageParams }>("/v1/conversations/:id/messages/:messageId/context", async (request, reply) => {
    try {
      return reply.send(await getMessageContext(
        uuidParam(request.params.id),
        uuidParam(request.params.messageId),
        await withWriteActor(request, { scope: "message-read", limit: 180 })
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/messages", async (request, reply) => {
    try {
      const actor = await withWriteActor(request, { shared: true, scope: "message-send", limit: 60 });
      return reply.send(await sendMessage(request.body, actor, mutationContextFromRequest(request, "message.send", request.body)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/conversations/groups", async (request, reply) => {
    try {
      const actor = await withWriteActor(request, { shared: true, scope: "group-create", limit: 20 });
      return reply.send(await createGroupConversation(request.body, actor, mutationContextFromRequest(request, "conversation.group.create", request.body)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/conversations/:id/invitations", async (request, reply) => {
    try {
      return reply.send(await inviteConversationParticipants(uuidParam(request.params.id), request.body, await withWriteActor(request, { scope: "group-invite", limit: 30 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/conversations/:id/participants", async (request, reply) => {
    try {
      return reply.send(await addConversationParticipants(uuidParam(request.params.id), request.body, await withWriteActor(request, { scope: "group-member-add", limit: 30 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/conversations/:id/invitation", async (request, reply) => {
    try {
      return reply.send(await resolveConversationInvite(uuidParam(request.params.id), request.body, await withWriteActor(request, { scope: "group-invite-resolve", limit: 30 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: ParticipantParams }>("/v1/conversations/:id/participants/:handle", async (request, reply) => {
    try {
      return reply.send(await updateConversationParticipant(uuidParam(request.params.id), handleParam(request.params.handle), request.body, await withWriteActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: ParticipantParams }>("/v1/conversations/:id/participants/:handle", async (request, reply) => {
    try {
      return reply.send(await removeConversationParticipant(uuidParam(request.params.id), handleParam(request.params.handle), await withWriteActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: RouteParams }>("/v1/conversations/:id/preferences", async (request, reply) => {
    try {
      return reply.send(await updateConversationPreferences(uuidParam(request.params.id), request.body, await withWriteActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: RouteParams }>("/v1/conversations/:id/draft", async (request, reply) => {
    try {
      const result = await saveConversationDraft(uuidParam(request.params.id), request.body, await withWriteActor(request, { scope: "message-draft", limit: 90 }));
      if (result.conflict) {
        return reply.status(409).send({ error: "This draft changed on another device.", draft: result.draft, requestId: request.id });
      }
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/conversations/:id/read", async (request, reply) => {
    try {
      return reply.send(await markConversationRead(uuidParam(request.params.id), request.body, await withWriteActor(request, { scope: "message-read-receipt", limit: 120 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/conversations/:id/leave", async (request, reply) => {
    try {
      return reply.send(await leaveConversation(uuidParam(request.params.id), await withWriteActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/conversations/:id/clear", async (request, reply) => {
    try {
      return reply.send(await clearConversation(uuidParam(request.params.id), await withWriteActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: RouteParams }>("/v1/conversations/:id", async (request, reply) => {
    try {
      return reply.send(await deleteConversationForViewer(uuidParam(request.params.id), await withWriteActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams; Querystring: Query }>("/v1/conversations/:id/search", async (request, reply) => {
    try {
      return reply.send(await searchConversation(uuidParam(request.params.id), request.query, await withWriteActor(request, { scope: "message-search", limit: 90 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams; Querystring: Query }>("/v1/conversations/:id/starred", async (request, reply) => {
    try {
      return reply.send(await listStarredMessages(uuidParam(request.params.id), request.query, await withWriteActor(request, { scope: "message-read", limit: 180 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: MessageParams }>("/v1/conversations/:id/messages/:messageId/star", async (request, reply) => {
    try {
      return reply.send(await starMessage(uuidParam(request.params.id), uuidParam(request.params.messageId), request.body, await withWriteActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: MessageParams }>("/v1/conversations/:id/messages/:messageId", async (request, reply) => {
    try {
      return reply.send({ message: await editMessage(uuidParam(request.params.id), uuidParam(request.params.messageId), request.body, await withWriteActor(request)) });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: MessageParams }>("/v1/conversations/:id/messages/:messageId", async (request, reply) => {
    try {
      return reply.send(await deleteMessage(uuidParam(request.params.id), uuidParam(request.params.messageId), request.body, await withWriteActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/blocks", async (request, reply) => {
    try {
      return reply.send(await setProfileBlock(request.body, await withWriteActor(request, { scope: "profile-block", limit: 30 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Querystring: Query }>("/v1/notifications", async (request, reply) => {
    try {
      return reply.send(await listNotifications(request.query, await withWriteActor(request, { scope: "notification-read", limit: 180 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/notifications/read", async (request, reply) => {
    try {
      return reply.send(await markNotificationRead(request.body, await withWriteActor(request, { scope: "notification-update", limit: 120 })));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: AttachmentParams }>("/v1/message-attachments/:attachmentId/access", async (request, reply) => {
    try {
      const attachment = await assertMessageAttachmentAccess(uuidParam(request.params.attachmentId), await withWriteActor(request, { scope: "message-attachment", limit: 120 }));
      return reply.send({ url: await createPrivateDownloadUrl(attachment.objectKey) });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
