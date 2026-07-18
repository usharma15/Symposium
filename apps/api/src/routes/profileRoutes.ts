import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import {
  followProfile,
  listFollowing,
  listProfileActivity,
  listProfileFollows,
  unfollowProfile,
} from "../repository/profiles";
import { getProfileByHandle, publicProfile } from "../repository/foundation";
import { listPublicProfiles } from "../repository/inquiryReads";
import { syncUser, upsertProfile } from "../repository/identity";
import { getActorFromRequest } from "../services/auth";
import { mutationContextFromRequest } from "../services/mutations";
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
      return reply.send({ profile: publicProfile(profile) });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Querystring: { limit?: string } }>("/v1/profiles", async (request, reply) => {
    try {
      return reply.send({ profiles: await listPublicProfiles(request.query.limit) });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: HandleParams }>("/v1/profiles/:handle", async (request, reply) => {
    try {
      const profile = await getProfileByHandle(request.params.handle);
      if (!profile) return reply.code(404).send({ error: "Profile not found." });
      return reply.send({ profile: publicProfile(profile) });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/profiles", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const mutation = mutationContextFromRequest(request, "profile.upsert", request.body);
      const profile = await upsertProfile(request.body, actor, mutation);
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
      const input = { ...(request.body ?? {}), targetHandle: request.params.handle };
      const mutation = mutationContextFromRequest(request, "profile.follow", input);
      const follow = await followProfile(input, actor, mutation);
      return reply.send({ follow });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: HandleParams }>("/v1/profiles/:handle/follow", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const input = { ...(request.body ?? {}), targetHandle: request.params.handle };
      const mutation = mutationContextFromRequest(request, "profile.unfollow", input);
      const follow = await unfollowProfile(input, actor, mutation);
      return reply.send({ follow });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
