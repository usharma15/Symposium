import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import {
  followProfile,
  getPublicInitialState,
  listFollowing,
  listProfileActivity,
  listProfileFollows,
  syncUser,
  unfollowProfile,
  upsertProfile
} from "../repository/liveRepository";
import { getActorFromRequest } from "../services/auth";
import type { HandleParams } from "./types";

type ProfileActivityQuery = {
  cursor?: string;
  limit?: string;
};

export const registerProfileRoutes = (app: FastifyInstance) => {
  app.post("/v1/auth/sync", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const profile = await syncUser(request.body, actor);
      return reply.send({ profile });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get("/v1/profiles", async (_request, reply) => {
    try {
      const state = await getPublicInitialState();
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

  app.get<{ Params: HandleParams }>("/v1/profiles/:handle/follows", async (request, reply) => {
    try {
      const follows = await listProfileFollows(request.params.handle);
      return reply.send(follows);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: HandleParams; Querystring: ProfileActivityQuery }>(
    "/v1/profiles/:handle/activity",
    async (request, reply) => {
      try {
        const actor = await getActorFromRequest(request);
        const activity = await listProfileActivity(request.params.handle, request.query, actor);
        return reply.send(activity);
      } catch (error) {
        return sendError(app, reply, error);
      }
    }
  );

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
      const follow = await unfollowProfile({ ...(request.body ?? {}), targetHandle: request.params.handle }, actor);
      return reply.send({ follow });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
