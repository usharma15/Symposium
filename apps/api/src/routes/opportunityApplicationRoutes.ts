import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import {
  addOpportunityApplicationComment,
  assertOpportunityAttachmentAccess,
  createOpportunityApplication,
  deleteOpportunityApplication,
  getOwnOpportunityApplication,
  listOpportunityApplications,
  updateOpportunityApplication
} from "../repository/opportunityApplications";
import { mutationContextFromRequest } from "../services/mutations";
import { createPrivateDownloadUrl } from "../services/storage";

type PostParams = { id: string };
type ApplicationParams = PostParams & { applicationId: string };

export const registerOpportunityApplicationRoutes = (app: FastifyInstance) => {
  app.get<{ Params: PostParams }>("/v1/posts/:id/opportunity/application", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send({ application: await getOwnOpportunityApplication(request.params.id, actor) });
    } catch (error) { return sendError(app, reply, error); }
  });

  app.post<{ Params: PostParams }>("/v1/posts/:id/opportunity/application", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const input = { ...(request.body as object), postId: request.params.id };
      const application = await createOpportunityApplication(input, actor, mutationContextFromRequest(request, "opportunity.application.create", input));
      return reply.send({ application });
    } catch (error) { return sendError(app, reply, error); }
  });

  app.get<{ Params: PostParams }>("/v1/posts/:id/opportunity/applications", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send({ applications: await listOpportunityApplications(request.params.id, actor) });
    } catch (error) { return sendError(app, reply, error); }
  });

  app.patch<{ Params: ApplicationParams }>("/v1/posts/:id/opportunity/applications/:applicationId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const application = await updateOpportunityApplication(request.params.id, request.params.applicationId, request.body, actor,
        mutationContextFromRequest(request, "opportunity.application.update", { postId: request.params.id, applicationId: request.params.applicationId, body: request.body }));
      return reply.send({ application });
    } catch (error) { return sendError(app, reply, error); }
  });

  app.delete<{ Params: ApplicationParams }>("/v1/posts/:id/opportunity/applications/:applicationId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const deleted = await deleteOpportunityApplication(request.params.id, request.params.applicationId, actor,
        mutationContextFromRequest(request, "opportunity.application.delete", { postId: request.params.id, applicationId: request.params.applicationId }));
      return reply.send({ deleted });
    } catch (error) { return sendError(app, reply, error); }
  });

  app.post<{ Params: ApplicationParams }>("/v1/posts/:id/opportunity/applications/:applicationId/comments", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const application = await addOpportunityApplicationComment(request.params.id, request.params.applicationId, request.body, actor,
        mutationContextFromRequest(request, "opportunity.application.comment.create", { postId: request.params.id, applicationId: request.params.applicationId, body: request.body }));
      return reply.send({ application });
    } catch (error) { return sendError(app, reply, error); }
  });

  app.get<{ Params: { attachmentId: string } }>("/v1/opportunity-attachments/:attachmentId/access", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const attachment = await assertOpportunityAttachmentAccess(request.params.attachmentId, actor);
      return reply.send({ url: await createPrivateDownloadUrl(attachment.objectKey) });
    } catch (error) { return sendError(app, reply, error); }
  });
};
