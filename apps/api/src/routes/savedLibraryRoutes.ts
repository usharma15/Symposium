import type { FastifyInstance } from "fastify";
import { withReadActor, withWriteActor } from "../http/actors";
import { sendError } from "../http/errors";
import {
  createSavedLibraryFolder,
  deleteSavedLibraryFolder,
  listSavedLibrary,
  updateSavedLibraryEntry,
  updateSavedLibraryFolder
} from "../repository/savedLibrary";
import { mutationContextFromRequest } from "../services/mutations";
import type { RouteParams } from "./types";

export const registerSavedLibraryRoutes = (app: FastifyInstance) => {
  app.get("/v1/saved-library", async (request, reply) => {
    try {
      return reply.send(await listSavedLibrary(await withReadActor(request)));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.post("/v1/saved-library/folders", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const folder = await createSavedLibraryFolder(
        request.body,
        actor,
        mutationContextFromRequest(request, "saved_library.folder.create", request.body)
      );
      return reply.send({ folder });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch<{ Params: RouteParams }>("/v1/saved-library/folders/:id", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const folder = await updateSavedLibraryFolder(
        request.params.id,
        request.body,
        actor,
        mutationContextFromRequest(request, "saved_library.folder.update", { folderId: request.params.id, body: request.body })
      );
      return reply.send({ folder });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.delete<{ Params: RouteParams }>("/v1/saved-library/folders/:id", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      return reply.send(await deleteSavedLibraryFolder(
        request.params.id,
        request.body,
        actor,
        mutationContextFromRequest(request, "saved_library.folder.delete", { folderId: request.params.id, body: request.body })
      ));
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.patch("/v1/saved-library/entries", async (request, reply) => {
    try {
      const actor = await withWriteActor(request);
      const entry = await updateSavedLibraryEntry(
        request.body,
        actor,
        mutationContextFromRequest(request, "saved_library.entry.update", request.body)
      );
      return reply.send({ entry });
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
