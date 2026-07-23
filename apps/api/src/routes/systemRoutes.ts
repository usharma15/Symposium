import type { FastifyInstance } from "fastify";
import { bootstrapResponseSchema } from "../../../../packages/contracts/src";
import { getRuntimeReadiness } from "../config/readiness";
import { sendError } from "../http/errors";
import { getBoundedBootstrap } from "../repository/inquiryReads";
import { search } from "../repository/search";
import { getActorFromRequest } from "../services/auth";

export const registerSystemRoutes = (app: FastifyInstance) => {
  app.get("/healthz", async () => ({
    ok: true,
    service: "symposium-api",
    time: new Date().toISOString()
  }));

  app.get<{ Querystring: { probe?: string } }>("/readyz", async (request, reply) => {
    try {
      const readiness = await getRuntimeReadiness({
        probeDatabase: request.query.probe === "database"
      });
      return reply.status(readiness.ok ? 200 : 503).send(readiness);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/bootstrap", async (request, reply) => {
    try {
      const actor = await getActorFromRequest(request);
      const state = await getBoundedBootstrap(actor.handle);
      return reply.send(bootstrapResponseSchema.parse(state));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Querystring: {
    q?: string;
    limit?: string;
    cursor?: string;
    room?: string;
    postTypes?: string;
    communityId?: string;
  } }>("/v1/search", async (request, reply) => {
    try {
      const actor = await getActorFromRequest(request);
      const results = await search({
        query: request.query.q ?? "",
        limit: request.query.limit ? Number(request.query.limit) : undefined,
        cursor: request.query.cursor,
        room: request.query.room,
        postTypes: request.query.postTypes?.split(",").filter(Boolean),
        communityId: request.query.communityId
      }, actor.handle);
      return reply.send(results);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
