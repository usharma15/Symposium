import { Transform, type Readable } from "node:stream";

export class AttachmentUploadSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentUploadSizeError";
  }
}

export const createBoundedAttachmentUploadStream = (source: Readable, expectedBytes: number) => {
  let receivedBytes = 0;
  const bounded = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk, encoding);
      receivedBytes += bytes;
      if (receivedBytes > expectedBytes) {
        callback(new AttachmentUploadSizeError("Uploaded attachment exceeded the prepared size."));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (receivedBytes !== expectedBytes) {
        callback(new AttachmentUploadSizeError("Uploaded attachment size did not match the prepared upload."));
        return;
      }
      callback();
    }
  });
  source.once("aborted", () => bounded.destroy(new AttachmentUploadSizeError("Attachment upload was interrupted.")));
  return source.pipe(bounded);
};
