import type { FastifyInstance } from "fastify";
import { withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import { mutationContextFromRequest } from "../services/mutations";
import {
  addComment,
  applyCommentAction,
  deleteComment,
  updateComment,
} from "../repository/comments";
import { getPostDetail, listPostPage } from "../repository/inquiryReads";
import { recordCommentView, recordPostView } from "../repository/inquiryViews";
import { applyPostAction, createPost, deletePost, updatePost } from "../repository/posts";
import { getContentAnalytics } from "../repository/contentAnalytics";
import { getActorFromRequest } from "../services/auth";
import type { RouteParams } from "./types";

export const registerPostRoutes = (app: FastifyInstance) => {
  app.get<{ Querystring: {
    cursor?: string;
    limit?: string;
    room?: string;
    postType?: string;
    postTypes?: string;
    communityId?: string;
    authorHandle?: string;
    saved?: string;
    following?: string;
    ids?: string;
    commentIds?: string;
  } }>("/v1/posts", async (request, reply) => {
    try {
      const actor = await getActorFromRequest(request);
      const page = await listPostPage({
        cursor: request.query.cursor,
        limit: request.query.limit ? Number(request.query.limit) : undefined,
        room: request.query.room,
        postType: request.query.postType,
        postTypes: request.query.postTypes?.split(",").filter(Boolean),
        communityId: request.query.communityId,
        authorHandle: request.query.authorHandle,
        saved: request.query.saved === "true" ? true : undefined,
        following: request.query.following === "true" ? true : undefined,
        ids: request.query.ids?.split(",").filter(Boolean),
        commentIds: request.query.commentIds?.split(",").filter(Boolean)
      }, actor.handle);
      return reply.send(page);
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams }>("/v1/posts/:id", async (request, reply) => {
    try {
      const actor = await getActorFromRequest(request);
      return reply.send(await getPostDetail(request.params.id, actor.handle));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: RouteParams; Querystring: {
    subjectType?: string;
    commentId?: string;
    view?: string;
    query?: string;
    cursor?: string;
    limit?: string;
  } }>("/v1/posts/:id/analytics", async (request, reply) => {
    try {
      return reply.send(await getContentAnalytics(
        request.params.id,
        request.query,
        await withWriteActor(request, { scope: "content-analytics", limit: 180 })
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/posts", async (request, reply) => {
    try {
      const actor = await withWriteActor(request, { shared: true, scope: "content-create", limit: 30 });
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
      const mutation = mutationContextFromRequest(request, "post.update", {
        postId: request.params.id,
        body: request.body
      });
      const item = await updatePost(request.params.id, request.body, actor, mutation);
      return reply.send({ item });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: RouteParams }>("/v1/posts/:id", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const mutation = mutationContextFromRequest(request, "post.delete", { postId: request.params.id });
      const item = await deletePost(request.params.id, actor, mutation);
      return reply.send({ item, deleted: { id: item.id } });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post<{ Params: RouteParams }>("/v1/posts/:id/comments", async (request, reply) => {
    try {
      const actor = await withWriteActor(request, { shared: true, scope: "content-create", limit: 30 });
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
      const mutation = mutationContextFromRequest(request, "comment.update", {
        postId: request.params.id,
        commentId: request.params.commentId,
        body: request.body
      });
      const item = await updateComment(
        request.params.id,
        request.params.commentId,
        request.body,
        actor,
        mutation
      );
      return reply.send({ item });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: RouteParams & { commentId: string } }>("/v1/posts/:id/comments/:commentId", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const mutation = mutationContextFromRequest(request, "comment.delete", {
        postId: request.params.id,
        commentId: request.params.commentId
      });
      const item = await deleteComment(
        request.params.id,
        request.params.commentId,
        request.body,
        actor,
        mutation
      );
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

  app.post<{ Params: RouteParams }>("/v1/posts/:id/views", async (request, reply) => {
    try {
      const actor = await withWriteActor(request, { scope: "passive-view", limit: 240 });
      return reply.send(await recordPostView(request.params.id, request.body, actor));
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

  app.post<{ Params: RouteParams & { commentId: string } }>("/v1/posts/:id/comments/:commentId/views", async (request, reply) => {
    try {
      const actor = await withWriteActor(request, { scope: "passive-view", limit: 240 });
      return reply.send(await recordCommentView(
        request.params.id,
        request.params.commentId,
        request.body,
        actor
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
