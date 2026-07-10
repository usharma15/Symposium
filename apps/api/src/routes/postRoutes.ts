import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import { mutationContextFromRequest } from "../services/mutations";
import {
  addComment,
  applyCommentAction,
  applyPostAction,
  createPost,
  deleteComment,
  deletePost,
  getPublicInitialState,
  updateComment,
  updatePost
} from "../repository/liveRepository";
import { getActorFromRequest } from "../services/auth";
import type { RouteParams } from "./types";

export const registerPostRoutes = (app: FastifyInstance) => {
  app.get("/v1/posts", async (request, reply) => {
    try {
      const actor = await getActorFromRequest(request);
      const state = await getPublicInitialState(actor.handle);
      return reply.send({ items: state.items });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/posts", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const mutation = mutationContextFromRequest(request, "post.create", request.body);
      const item = await createPost(request.body, actor, mutation);
      return reply.send({ item });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: RouteParams }>("/v1/posts/:id", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const item = await updatePost(request.params.id, request.body, actor);
      return reply.send({ item });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: RouteParams }>("/v1/posts/:id", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const item = await deletePost(request.params.id, actor);
      return reply.send({ item, deleted: { id: item.id } });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/posts/:id/comments", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const mutation = mutationContextFromRequest(request, "comment.create", {
        postId: request.params.id,
        body: request.body
      });
      const result = await addComment(request.params.id, request.body, actor, mutation);
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: RouteParams & { commentId: string } }>("/v1/posts/:id/comments/:commentId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const item = await updateComment(request.params.id, request.params.commentId, request.body, actor);
      return reply.send({ item });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: RouteParams & { commentId: string } }>("/v1/posts/:id/comments/:commentId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const item = await deleteComment(request.params.id, request.params.commentId, request.body, actor);
      return reply.send({ item, deleted: { id: request.params.commentId } });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/posts/:id/actions", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const mutation = mutationContextFromRequest(request, "post.action", {
        postId: request.params.id,
        body: request.body
      });
      const result = await applyPostAction(request.params.id, request.body, actor, mutation);
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams & { commentId: string } }>("/v1/posts/:id/comments/:commentId/actions", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const mutation = mutationContextFromRequest(request, "comment.action", {
        postId: request.params.id,
        commentId: request.params.commentId,
        body: request.body
      });
      const result = await applyCommentAction(
        request.params.id,
        request.params.commentId,
        request.body,
        actor,
        mutation
      );
      return reply.send(result);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
