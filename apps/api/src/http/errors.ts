import { TRPCError } from "@trpc/server";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";

const logRouteError = (app: FastifyInstance, reply: FastifyReply, error: unknown, status: number) => {
  const context = { requestId: reply.request.id, status };
  if (status >= 500) {
    app.log.error({ ...context, err: error }, "Request failed");
    return;
  }

  app.log.warn({ ...context, err: error }, "Request rejected");
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
    logRouteError(app, reply, error, status);
    return reply.status(status).send({ error: error.message, requestId: reply.request.id });
  }

  if (error instanceof ZodError) {
    app.log.warn({ issues: error.issues, requestId: reply.request.id }, "Invalid request payload");
    return reply.status(400).send({ error: "Invalid request payload.", issues: error.issues, requestId: reply.request.id });
  }

  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    Number((error as { statusCode?: unknown }).statusCode) === 413
  ) {
    logRouteError(app, reply, error, 413);
    return reply.status(413).send({ error: "Request body is too large.", requestId: reply.request.id });
  }

  logRouteError(app, reply, error, 500);
  return reply.status(500).send({
    error: "The live service could not complete this request.",
    requestId: reply.request.id
  });
};
