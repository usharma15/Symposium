import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import { env, webOrigins } from "./config/env";
import { assertDeploymentEnv } from "./config/preflight";
import { ensureDatabase } from "./db/migrate";
import { attachRealtime } from "./realtime";
import { appRouter } from "./router";
import { registerCommunityRoutes } from "./routes/communityRoutes";
import { registerPostRoutes } from "./routes/postRoutes";
import { registerProfileRoutes } from "./routes/profileRoutes";
import { registerSystemRoutes } from "./routes/systemRoutes";
import { registerWorkspaceRoutes } from "./routes/workspaceRoutes";
import { createContext } from "./trpc";

export const buildApp = async () => {
  const app = Fastify({
    logger: true,
    trustProxy: true
  });

  await app.register(cors, {
    origin: webOrigins,
    credentials: true
  });

  registerSystemRoutes(app);

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext
    }
  });

  registerProfileRoutes(app);
  registerPostRoutes(app);
  registerCommunityRoutes(app);
  registerWorkspaceRoutes(app);

  attachRealtime(app);
  return app;
};

const start = async () => {
  assertDeploymentEnv();
  const app = await buildApp();
  await ensureDatabase();
  await app.listen({ host: env.HOST, port: env.PORT });
};

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { start };
