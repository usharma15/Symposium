import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import { mutationContextFromRequest } from "../services/mutations";
import { getActorFromRequest } from "../services/auth";
import {
  createCommunity,
  createCommunityCall,
  endCommunityCall,
  joinCommunityCall,
  joinOrRequestCommunity,
  leaveCommunity,
  listCommunityCalls,
  listCommunityMembers,
  recordCommunityAccess
} from "../repository/communities";
import { getPublicCommunity, listPublicCommunities } from "../repository/foundation";
import type { RouteParams } from "./types";

export const registerCommunityRoutes = (app: FastifyInstance) => {
  app.get("/v1/communities", async (request, reply) => {
    try {
      const actor = await getActorFromRequest(request);
      const communities = await listPublicCommunities(actor.handle);
      return reply.send({ communities });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/communities", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const community = await createCommunity(
        request.body,
        actor,
        mutationContextFromRequest(request, "community.create", request.body)
      );
      return reply.send({ community });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams }>("/v1/communities/:id", async (request, reply) => {
    try {
      const actor = await getActorFromRequest(request);
      const community = await getPublicCommunity(request.params.id, actor.handle);
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

  app.delete<{ Params: RouteParams }>("/v1/communities/:id/membership", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const result = await leaveCommunity({ communityId: request.params.id }, actor);
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/communities/:id/access", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const result = await recordCommunityAccess({ communityId: request.params.id }, actor);
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams }>("/v1/communities/:id/calls", async (request, reply) => {
    try {
      const result = await listCommunityCalls(request.params.id, await getActorFromRequest(request));
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams; Querystring: Record<string, string | undefined> }>("/v1/communities/:id/members", async (request, reply) => {
    try {
      return reply.send(await listCommunityMembers(request.params.id, await getActorFromRequest(request), request.query));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/communities/:id/calls", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const payload = { ...(request.body ?? {}), communityId: request.params.id };
      const call = await createCommunityCall(
        payload,
        actor,
        mutationContextFromRequest(request, "community.call.create", payload)
      );
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
