import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import { confirmAttachment, createAttachmentUpload } from "../repository/liveRepository";
import { mutationContextFromRequest } from "../services/mutations";

export const registerAttachmentRoutes = (app: FastifyInstance) => {
  app.post("/v1/attachments/upload", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const upload = await createAttachmentUpload(
        request.body,
        actor,
        mutationContextFromRequest(request, "attachment.prepare", request.body)
      );
      return reply.send(upload);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/attachments/confirm", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const attachment = await confirmAttachment(request.body, actor);
      return reply.send(attachment);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
