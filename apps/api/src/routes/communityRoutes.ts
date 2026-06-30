import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import {
  createCommunityCall,
  endCommunityCall,
  getCommunity,
  joinCommunityCall,
  joinOrRequestCommunity,
  listCommunities,
  listCommunityCalls
} from "../repository/liveRepository";
import type { RouteParams } from "./types";

export const registerCommunityRoutes = (app: FastifyInstance) => {
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
};
