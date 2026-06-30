import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import {
  addComment,
  applyPostAction,
  createPost,
  getInitialState
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
};
