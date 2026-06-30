import cors from "@fastify/cors";
import { TRPCError } from "@trpc/server";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { fileURLToPath } from "node:url";
import { bootstrapResponseSchema } from "../../../packages/contracts/src";
import { env, webOrigins } from "./config/env";
import { assertDeploymentEnv } from "./config/preflight";
import { ensureDatabase } from "./db/migrate";
import {
  addComment,
  askAssistant,
  applyPostAction,
  createCommunityCall,
  createOpportunity,
  createPost,
  endCommunityCall,
  followProfile,
  getCommunity,
  getInitialState,
  getWorkspace,
  joinCommunityCall,
  joinOrRequestCommunity,
  listCommunityCalls,
  listCommunities,
  listConversations,
  listFollowing,
  listNotifications,
  listOpportunities,
  publishNote,
  saveNoteBlock,
  sendMessage,
  syncUser,
  unfollowProfile,
  upsertProfile
} from "./repository/liveRepository";
import { appRouter } from "./router";
import { attachRealtime } from "./realtime";
import { getActorFromRequest, requireActor } from "./services/auth";
import { rateLimit } from "./services/rateLimit";
import { createContext } from "./trpc";

type RouteParams = {
  id: string;
};

type HandleParams = {
  handle: string;
};

const withWriteActor = async (request: FastifyRequest) => {
  const actor = requireActor(await getActorFromRequest(request));
  await rateLimit(request, actor, "rest-write", 120, 60);
  return actor;
};

const sendError = (app: FastifyInstance, reply: FastifyReply, error: unknown) => {
  app.log.error(error);

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

    return reply.status(statusByCode[error.code] ?? 500).send({ error: error.message });
  }

  const message = error instanceof Error ? error.message : "Unknown backend error.";
  return reply.status(message.includes("required") ? 400 : 500).send({ error: message });
};

export const buildApp = async () => {
  const app = Fastify({
    logger: true,
    trustProxy: true
  });

  await app.register(cors, {
    origin: webOrigins,
    credentials: true
  });

  app.get("/healthz", async () => ({
    ok: true,
    service: "symposium-api",
    time: new Date().toISOString()
  }));

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext
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

  app.post("/v1/auth/sync", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const profile = await syncUser(request.body, actor);
      return reply.send({ profile });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/posts", async (_request, reply) => {
    try {
      const state = await getInitialState();
      return reply.send({ items: state.items });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/posts", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const item = await createPost(request.body, actor);
      return reply.send({ item });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/profiles", async (_request, reply) => {
    try {
      const state = await getInitialState();
      return reply.send({ profiles: state.profiles });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/profiles", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const profile = await upsertProfile(request.body, actor);
      return reply.send({ profile });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/follows", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const follows = await listFollowing(actor);
      return reply.send(follows);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: HandleParams }>("/v1/profiles/:handle/follow", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const follow = await followProfile({ ...(request.body ?? {}), targetHandle: request.params.handle }, actor);
      return reply.send({ follow });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: HandleParams }>("/v1/profiles/:handle/follow", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const follow = await unfollowProfile({ targetHandle: request.params.handle }, actor);
      return reply.send({ follow });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/posts/:id/comments", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const comment = await addComment(request.params.id, request.body, actor);
      return reply.send({ comment });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/posts/:id/actions", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const item = await applyPostAction(request.params.id, request.body, actor);
      return reply.send({ item });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/communities", async (_request, reply) => {
    try {
      const communities = await listCommunities();
      return reply.send({ communities });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams }>("/v1/communities/:id", async (request, reply) => {
    try {
      const community = await getCommunity(request.params.id);
      return reply.send({ community });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/communities/:id/join", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const result = await joinOrRequestCommunity({ communityId: request.params.id }, actor);
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams }>("/v1/communities/:id/calls", async (request, reply) => {
    try {
      const result = await listCommunityCalls(request.params.id);
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/communities/:id/calls", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const call = await createCommunityCall({ ...(request.body ?? {}), communityId: request.params.id }, actor);
      return reply.send({ call });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/calls/:id/join", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const result = await joinCommunityCall({ callId: request.params.id }, actor);
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/calls/:id/end", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const result = await endCommunityCall({ callId: request.params.id }, actor);
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/opportunities", async (request, reply) => {
    try {
      const opportunities = await listOpportunities(request.query);
      return reply.send({ opportunities });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/opportunities", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const opportunity = await createOpportunity(request.body, actor);
      return reply.send({ opportunity });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/conversations", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const conversations = await listConversations(actor);
      return reply.send({ conversations });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/messages", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const message = await sendMessage(request.body, actor);
      return reply.send({ message });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/notifications", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const notifications = await listNotifications(actor);
      return reply.send({ notifications });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/workspace", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const workspace = await getWorkspace(actor);
      return reply.send(workspace);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/notes/blocks", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const block = await saveNoteBlock(request.body, actor);
      return reply.send({ block });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/notes/publish", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const publication = await publishNote(request.body, actor);
      return reply.send(publication);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/assistant/messages", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const response = await askAssistant(request.body, actor);
      return reply.send(response);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

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
