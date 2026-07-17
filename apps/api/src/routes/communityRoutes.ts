import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import { mutationContextFromRequest } from "../services/mutations";
import { getActorFromRequest } from "../services/auth";
import {
  createCommunity,
  createCommunityAnnouncement,
  createCommunityCall,
  endCommunityCall,
  joinCommunityCall,
  joinOrRequestCommunity,
  leaveCommunity,
  listCommunityCalls,
  removeCommunityMember,
  updateCommunityMember,
  updateCommunitySettings
} from "../repository/communities";
import { listCommunityMembers, recordCommunityAccess } from "../repository/communityMembers";
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

  app.patch<{ Params: RouteParams }>("/v1/communities/:id", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const payload = { ...(request.body ?? {}), communityId: request.params.id };
      const community = await updateCommunitySettings(
        payload,
        actor,
        mutationContextFromRequest(request, "community.settings.update", payload)
      );
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

  app.patch<{ Params: RouteParams & { handle: string } }>("/v1/communities/:id/members/:handle", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const payload = { ...(request.body ?? {}), communityId: request.params.id, memberHandle: request.params.handle };
      return reply.send(await updateCommunityMember(payload, actor, mutationContextFromRequest(request, "community.member.role.update", payload)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: RouteParams & { handle: string } }>("/v1/communities/:id/members/:handle", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const payload = { ...(request.body ?? {}), communityId: request.params.id, memberHandle: request.params.handle };
      return reply.send(await removeCommunityMember(payload, actor, mutationContextFromRequest(request, "community.member.remove", payload)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/communities/:id/announcements", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const payload = { ...(request.body ?? {}), communityId: request.params.id };
      return reply.send(await createCommunityAnnouncement(payload, actor, mutationContextFromRequest(request, "community.announcement.create", payload)));
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
