import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { attachmentStorageBucket, attachmentStorageMode } from "../config/env";
import { getPool } from "../db/client";
import { sendError } from "../http/errors";
import {
  assertSafeStorageObjectKey,
  openFilesystemStoredObject,
  verifyPrivateFilesystemDownload
} from "../services/storage";

type ObjectParams = { "*": string };
type PrivateQuery = { expires?: string; signature?: string };

type DeliveryRow = {
  byteSize: number;
  contentType: string;
  fileName: string;
  objectKey: string;
};

const parseRange = (header: string | undefined, byteSize: number) => {
  if (!header) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : undefined;
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    start >= byteSize ||
    (end !== undefined && (!Number.isSafeInteger(end) || end < start))
  ) {
    return null;
  }
  return { end, start };
};

const sendFilesystemObject = async (
  request: FastifyRequest,
  reply: FastifyReply,
  row: DeliveryRow,
  cacheControl: string
) => {
  const range = parseRange(request.headers.range, row.byteSize);
  if (range === null) {
    return reply
      .header("Accept-Ranges", "bytes")
      .header("Content-Range", `bytes */${row.byteSize}`)
      .status(416)
      .send();
  }
  const object = await openFilesystemStoredObject(row.objectKey, range);
  const partial = Boolean(range);
  reply
    .header("Accept-Ranges", "bytes")
    .header("Cache-Control", cacheControl)
    .header("Content-Length", String(object.end - object.start + 1))
    .header("Content-Type", row.contentType)
    .header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`);
  if (partial) {
    reply
      .header("Content-Range", `bytes ${object.start}-${object.end}/${object.byteSize}`)
      .status(206);
  }
  return reply.send(object.stream);
};

const objectKeyFromRequest = (request: FastifyRequest<{ Params: ObjectParams }>) =>
  assertSafeStorageObjectKey(request.params["*"]);

export const registerStorageRoutes = (app: FastifyInstance) => {
  app.get<{ Params: ObjectParams }>("/v1/storage/public/*", async (request, reply) => {
    try {
      if (attachmentStorageMode !== "filesystem") return reply.status(404).send({ error: "Not found." });
      const objectKey = objectKeyFromRequest(request);
      const result = await getPool().query<DeliveryRow>(
        `SELECT
           byte_size AS "byteSize",
           content_type AS "contentType",
           file_name AS "fileName",
           object_key AS "objectKey"
         FROM attachments
         WHERE bucket = $1
           AND object_key = $2
           AND owner_type IN ('post', 'comment', 'profile')
           AND status IN ('uploaded', 'previewed')
           AND COALESCE(metadata->>'storageState', '') NOT IN ('deletion_pending', 'deleted')
         LIMIT 1`,
        [attachmentStorageBucket, objectKey]
      );
      const row = result.rows[0];
      if (!row) return reply.status(404).send({ error: "Attachment not found." });
      return sendFilesystemObject(request, reply, row, "public, max-age=31536000, immutable");
    } catch (error) {
      return sendError(app, reply, error);
    }
  });

  app.get<{ Params: ObjectParams; Querystring: PrivateQuery }>("/v1/storage/private/*", async (request, reply) => {
    try {
      if (attachmentStorageMode !== "filesystem") return reply.status(404).send({ error: "Not found." });
      const objectKey = objectKeyFromRequest(request);
      if (!verifyPrivateFilesystemDownload(
        objectKey,
        request.query.expires,
        request.query.signature
      )) {
        return reply.status(404).send({ error: "Attachment not found." });
      }
      const result = await getPool().query<DeliveryRow>(
        `SELECT
           byte_size AS "byteSize",
           content_type AS "contentType",
           file_name AS "fileName",
           object_key AS "objectKey"
         FROM attachments
         WHERE bucket = $1
           AND object_key = $2
           AND status IN ('uploaded', 'previewed')
           AND COALESCE(metadata->>'storageState', '') NOT IN ('deletion_pending', 'deleted')
         LIMIT 1`,
        [attachmentStorageBucket, objectKey]
      );
      const row = result.rows[0];
      if (!row) return reply.status(404).send({ error: "Attachment not found." });
      return sendFilesystemObject(request, reply, row, "private, no-store");
    } catch (error) {
      return sendError(app, reply, error);
    }
  });
};
