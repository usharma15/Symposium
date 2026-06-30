import type { FastifyInstance } from "fastify";
import { bootstrapResponseSchema } from "../../../../packages/contracts/src";
import { getRuntimeReadiness } from "../config/readiness";
import { sendError } from "../http/errors";
import { getInitialState } from "../repository/liveRepository";

export const registerSystemRoutes = (app: FastifyInstance) => {
  app.get("/healthz", async () => ({
    ok: true,
    service: "symposium-api",
    time: new Date().toISOString()
  }));

  app.get("/readyz", async (_request, reply) => {
    try {
      const readiness = await getRuntimeReadiness();
      return reply.status(readiness.ok ? 200 : 503).send(readiness);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/bootstrap", async (_request, reply) => {
    try {
      const state = await getInitialState();
      return reply.send(bootstrapResponseSchema.parse(state));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
