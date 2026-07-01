import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import {
  addComment,
  applyCommentAction,
  applyPostAction,
  createPost,
  deletePost,
  getInitialState,
  updatePost
} from "../repository/liveRepository";
import type { RouteParams } from "./types";

export const registerPostRoutes = (app: FastifyInstance) => {
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
      const deleted = await deletePost(request.params.id, actor);
      return reply.send({ deleted });
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

  app.post<{ Params: RouteParams & { commentId: string } }>("/v1/posts/:id/comments/:commentId/actions", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const item = await applyCommentAction(request.params.id, request.params.commentId, request.body, actor);
      return reply.send({ item });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
