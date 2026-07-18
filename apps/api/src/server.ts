import cors from "@fastify/cors";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { env, webOrigins } from "./config/env";
import { assertDeploymentEnv } from "./config/preflight";
import { ensureDatabase } from "./db/migrate";
import { sendError } from "./http/errors";
import { registerAttachmentRoutes } from "./routes/attachmentRoutes";
import { registerCommunityRoutes } from "./routes/communityRoutes";
import { registerEventRoutes } from "./routes/eventRoutes";
import { registerMessageRoutes } from "./routes/messageRoutes";
import { registerPostRoutes } from "./routes/postRoutes";
import { registerOpportunityApplicationRoutes } from "./routes/opportunityApplicationRoutes";
import { registerProfileRoutes } from "./routes/profileRoutes";
import { registerSystemRoutes } from "./routes/systemRoutes";
import { registerWorkspaceRoutes } from "./routes/workspaceRoutes";
import { startDatabaseMaintenance, stopDatabaseMaintenance } from "./services/maintenance";
import { rateLimit } from "./services/rateLimit";
import {
  completeRequestCost,
  createRequestCostState,
  responsePayloadBytes,
  runWithRequestCost,
  shouldSampleRequestCost,
  type RequestCostState
} from "./services/requestCosts";

export const buildApp = async (options: { logger?: boolean } = {}) => {
  const requestCosts = new WeakMap<object, RequestCostState>();
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    logger: options.logger === false
      ? false
      : {
          redact: ["req.headers.authorization", "req.headers.cookie"]
        },
    requestTimeout: 15_000,
    return503OnClosing: true,
    routerOptions: { maxParamLength: 300 },
    trustProxy: 1
  });

  app.addHook("onRequest", (request, _reply, done) => {
    const cost = createRequestCostState();
    requestCosts.set(request, cost);
    runWithRequestCost(cost, done);
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Timing-Allow-Origin", webOrigins.join(", "));
    if (request.url.startsWith("/v1/")) {
      reply.header("Cache-Control", "no-store");
    }
    if (request.method === "OPTIONS") return;
    await rateLimit(request, { isAuthenticated: false, source: "anonymous" }, "request", 300, 60);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const cost = requestCosts.get(request);
    if (!cost) return payload;
    const route = request.routeOptions.url ?? "unmatched";
    const snapshot = completeRequestCost(cost, {
      method: request.method,
      route,
      statusCode: reply.statusCode,
      responseBytes: responsePayloadBytes(payload)
    });
    const log = {
      event: snapshot.violations.length ? "request_cost_budget_exceeded" : "request_cost_sample",
      method: snapshot.method,
      route: snapshot.route,
      statusCode: snapshot.statusCode,
      queryCount: snapshot.queryCount,
      queryErrors: snapshot.queryErrors,
      queryDurationMs: Number(snapshot.queryDurationMs.toFixed(2)),
      responseBytes: snapshot.responseBytes,
      totalDurationMs: Number(snapshot.totalDurationMs.toFixed(2)),
      violations: snapshot.violations,
      budget: snapshot.budget
    };
    if (snapshot.violations.length) request.log.warn(log, "Request cost budget exceeded");
    else if (shouldSampleRequestCost(request.id)) request.log.info(log, "Request cost sample");
    reply.header(
      "Server-Timing",
      `db;dur=${log.queryDurationMs};desc="${log.queryCount} queries", app;dur=${log.totalDurationMs}`
    );
    return payload;
  });

  await app.register(cors, {
    origin: webOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"]
  });

  app.setErrorHandler((error, _request, reply) => sendError(app, reply, error));

  registerSystemRoutes(app);

  registerProfileRoutes(app);
  registerPostRoutes(app);
  registerOpportunityApplicationRoutes(app);
  registerCommunityRoutes(app);
  registerAttachmentRoutes(app);
  registerMessageRoutes(app);
  registerWorkspaceRoutes(app);
  registerEventRoutes(app);

  return app;
};

const start = async () => {
  assertDeploymentEnv();
  const app = await buildApp();
  await ensureDatabase();
  startDatabaseMaintenance();
  app.addHook("onClose", async () => {
    stopDatabaseMaintenance();
  });
  await app.listen({ host: env.HOST, port: env.PORT });
};

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { start };
