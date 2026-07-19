import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import { confirmAttachment, createAttachmentUpload, uploadAttachmentContent } from "../repository/attachments";
import { mutationContextFromRequest } from "../services/mutations";

type AttachmentParams = { attachmentId: string };

const readableBody = (value: unknown): value is Readable =>
  Boolean(value && typeof (value as Readable).pipe === "function");

export const registerAttachmentRoutes = (app: FastifyInstance) => {
  app.post("/v1/attachments/upload", async (request, reply) => {
    try {
      const actor = await withWriteActor(request, { shared: true, scope: "attachment", limit: 30 });
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
      const actor = await withWriteActor(request, { shared: true, scope: "attachment", limit: 30 });
      const attachment = await confirmAttachment(request.body, actor);
      return reply.send(attachment);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.put<{ Params: AttachmentParams; Body: Readable }>(
    "/v1/attachments/:attachmentId/content",
    { bodyLimit: 50 * 1024 * 1024 },
    async (request, reply) => {
      try {
        if (typeof request.raw.setTimeout === "function") request.raw.setTimeout(120_000);
        if (!readableBody(request.body)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment upload body is missing." });
        }
        const attachmentId = z.string().uuid().parse(request.params.attachmentId);
        const contentLength = request.headers["content-length"];
        const declaredByteSize = typeof contentLength === "string" && /^\d+$/.test(contentLength)
          ? Number(contentLength)
          : null;
        const actor = await withWriteActor(request, { shared: true, scope: "attachment-content", limit: 30 });
        const uploaded = await uploadAttachmentContent(attachmentId, request.body, declaredByteSize, actor);
        return reply.send(uploaded);
      } catch (error) {
        return sendError(app, reply, error);
      }
    }
  );
};
