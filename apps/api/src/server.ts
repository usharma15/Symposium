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
import { registerPostRoutes } from "./routes/postRoutes";
import { registerOpportunityApplicationRoutes } from "./routes/opportunityApplicationRoutes";
import { registerProfileRoutes } from "./routes/profileRoutes";
import { registerSystemRoutes } from "./routes/systemRoutes";
import { registerWorkspaceRoutes } from "./routes/workspaceRoutes";
import { startDatabaseMaintenance, stopDatabaseMaintenance } from "./services/maintenance";
import { rateLimit } from "./services/rateLimit";

export const buildApp = async (options: { logger?: boolean } = {}) => {
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

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
    reply.header("X-Content-Type-Options", "nosniff");
    if (request.url.startsWith("/v1/")) {
      reply.header("Cache-Control", "no-store");
    }
    if (request.method === "OPTIONS") return;
    await rateLimit(request, { isAuthenticated: false, source: "anonymous" }, "request", 300, 60);
  });

  await app.register(cors, {
    origin: webOrigins,
    credentials: true
  });

  app.setErrorHandler((error, _request, reply) => sendError(app, reply, error));

  registerSystemRoutes(app);

  registerProfileRoutes(app);
  registerPostRoutes(app);
  registerOpportunityApplicationRoutes(app);
  registerCommunityRoutes(app);
  registerAttachmentRoutes(app);
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
