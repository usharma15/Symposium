import { TRPCError } from "@trpc/server";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";

const logRouteError = (app: FastifyInstance, error: unknown, status: number) => {
  if (status >= 500) {
    app.log.error(error);
    return;
  }

  app.log.warn(error);
};

export const sendError = (app: FastifyInstance, reply: FastifyReply, error: unknown) => {
  if (error instanceof TRPCError) {
    const statusByCode: Partial<Record<typeof error.code, number>> = {
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      PRECONDITION_FAILED: 412,
      TOO_MANY_REQUESTS: 429
    };

    const status = statusByCode[error.code] ?? 500;
    logRouteError(app, error, status);
    return reply.status(status).send({ error: error.message });
  }

  if (error instanceof ZodError) {
    app.log.warn({ issues: error.issues }, "Invalid request payload");
    return reply.status(400).send({ error: "Invalid request payload.", issues: error.issues });
  }

  const message = error instanceof Error ? error.message : "Unknown backend error.";
  const status = message.includes("required") ? 400 : 500;
  logRouteError(app, error, status);
  return reply.status(status).send({ error: message });
};
