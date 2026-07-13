import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachmentKindForContentType, validateAttachmentContentSignature } from "@/lib/attachmentRules";
import { officeArchiveFormatForContentType, validateOfficeArchive } from "@/lib/docxSecurity";
import type { InquiryAttachment } from "@/lib/mockData";

type LocalAttachmentOwnerType = "post" | "comment" | "message" | "note" | "profile";
type LocalAttachmentStatus = "pending" | "uploaded";

export type LocalAttachmentRecord = {
  attachmentId: string;
  actorHandle?: string;
  byteSize: number;
  contentType: string;
  createdAt: string;
  fileName: string;
  metadata?: Record<string, unknown>;
  ownerId?: string;
  ownerType: LocalAttachmentOwnerType;
  status: LocalAttachmentStatus;
  storedFileName: string;
  updatedAt: string;
  urlFileName: string;
};

type LocalAttachmentStore = {
  version: 1;
  attachments: Record<string, LocalAttachmentRecord>;
};

type CreateLocalAttachmentUploadInput = {
  actorHandle?: string;
  byteSize: number;
  contentType: string;
  fileName: string;
  ownerId?: string;
  ownerType: LocalAttachmentOwnerType;
};

type ConfirmLocalAttachmentInput = {
  attachmentId: string;
  byteSize?: number;
  metadata?: Record<string, unknown>;
};

export class LocalAttachmentStoreError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const attachmentRoot = path.join(process.cwd(), ".data", "attachments");
const filesRoot = path.join(attachmentRoot, "files");
const indexPath = path.join(attachmentRoot, "index.json");

let storeQueue: Promise<void> = Promise.resolve();

const withStoreLock = async <T>(operation: () => Promise<T>) => {
  const run = storeQueue.then(operation, operation);
  storeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

const ensureStoreDirectory = async () => {
  await mkdir(filesRoot, { recursive: true });
};

const emptyStore = (): LocalAttachmentStore => ({
  version: 1,
  attachments: {}
});

const loadStore = async () => {
  await ensureStoreDirectory();

  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<LocalAttachmentStore>;
    return {
      version: 1,
      attachments: parsed.attachments ?? {}
    } satisfies LocalAttachmentStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
};

const saveStore = async (store: LocalAttachmentStore) => {
  await ensureStoreDirectory();
  const temporaryPath = `${indexPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporaryPath, indexPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
};

const sanitizeFileName = (fileName: string) => {
  const cleaned = fileName
    .replace(/[/\\]/g, "-")
    .replace(/[^\w .()[\]-]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  return cleaned || "attachment";
};

const recordFilePath = (record: LocalAttachmentRecord) => path.join(filesRoot, record.storedFileName);

export const localAttachmentPublicPath = (record: LocalAttachmentRecord) =>
  `/api/attachments/local/${encodeURIComponent(record.attachmentId)}/${encodeURIComponent(record.urlFileName)}`;

export const createLocalAttachmentUpload = async (input: CreateLocalAttachmentUploadInput) =>
  withStoreLock(async () => {
    const attachmentId = randomUUID();
    const safeFileName = sanitizeFileName(input.fileName);
    const now = new Date().toISOString();
    const record: LocalAttachmentRecord = {
      attachmentId,
      actorHandle: input.actorHandle,
      byteSize: input.byteSize,
      contentType: input.contentType,
      createdAt: now,
      fileName: input.fileName,
      ownerId: input.ownerId,
      ownerType: input.ownerType,
      status: "pending",
      storedFileName: `${attachmentId}-${safeFileName}`,
      updatedAt: now,
      urlFileName: safeFileName
    };
    const store = await loadStore();
    store.attachments[attachmentId] = record;
    await saveStore(store);

    return {
      attachmentId,
      uploadUrl: `/api/attachments/local-upload/${encodeURIComponent(attachmentId)}`,
      publicUrl: localAttachmentPublicPath(record)
    };
  });

export const writeLocalAttachmentFile = async (attachmentId: string, bytes: Buffer) =>
  withStoreLock(async () => {
    const store = await loadStore();
    const record = store.attachments[attachmentId];
    if (!record) throw new LocalAttachmentStoreError("Attachment upload not found.", 404);
    if (record.status !== "pending") throw new LocalAttachmentStoreError("Attachment upload is already complete.", 409);
    if (bytes.byteLength !== record.byteSize) {
      throw new LocalAttachmentStoreError("Uploaded attachment size did not match the prepared upload.", 400);
    }
    const signatureError = validateAttachmentContentSignature(record.contentType, bytes.slice(0, 65_536));
    if (signatureError) throw new LocalAttachmentStoreError(signatureError, 400);
    const officeFormat = officeArchiveFormatForContentType(record.contentType);
    if (officeFormat && !(await validateOfficeArchive(bytes, officeFormat))) {
      throw new LocalAttachmentStoreError("The uploaded file is not a valid or safe Office document.", 400);
    }

    const filePath = recordFilePath(record);
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, bytes);
      await rename(temporaryPath, filePath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
    const updatedRecord: LocalAttachmentRecord = {
      ...record,
      status: "uploaded",
      updatedAt: new Date().toISOString()
    };
    store.attachments[attachmentId] = updatedRecord;
    await saveStore(store);
    return updatedRecord;
  });

export const confirmLocalAttachment = async (input: ConfirmLocalAttachmentInput) =>
  withStoreLock(async () => {
    const store = await loadStore();
    const record = store.attachments[input.attachmentId];
    if (!record) throw new LocalAttachmentStoreError("Attachment upload not found.", 404);
    if (record.status !== "uploaded") throw new LocalAttachmentStoreError("Upload the attachment before confirming it.", 409);
    if (input.byteSize !== undefined && input.byteSize !== record.byteSize) {
      throw new LocalAttachmentStoreError("Confirmed attachment size did not match the uploaded file.", 400);
    }

    const updatedRecord: LocalAttachmentRecord = {
      ...record,
      metadata: input.metadata ?? record.metadata,
      updatedAt: new Date().toISOString()
    };
    store.attachments[input.attachmentId] = updatedRecord;
    await saveStore(store);
    return updatedRecord;
  });

export const readLocalAttachment = async (attachmentId: string) => {
  const store = await loadStore();
  const record = store.attachments[attachmentId];
  if (!record || record.status !== "uploaded") throw new LocalAttachmentStoreError("Attachment not found.", 404);

  return {
    record,
    bytes: await readFile(recordFilePath(record))
  };
};

const localRecordToAttachment = (record: LocalAttachmentRecord): InquiryAttachment => ({
  id: record.attachmentId,
  fileName: record.fileName,
  contentType: record.contentType,
  byteSize: record.byteSize,
  url: localAttachmentPublicPath(record),
  status: "uploaded",
  kind: attachmentKindForContentType(record.contentType, record.fileName),
  metadata: record.metadata,
  createdAt: record.createdAt
});

export const replaceLocalOwnerAttachments = async (input: {
  actorHandle?: string;
  attachmentIds: string[];
  ownerId: string;
  ownerType: "post" | "comment";
}) =>
  withStoreLock(async () => {
    if (input.attachmentIds.length > 10) {
      throw new LocalAttachmentStoreError(`${input.ownerType === "post" ? "Posts" : "Comments"} can have up to 10 attachments.`, 400);
    }
    if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
      throw new LocalAttachmentStoreError(`Each ${input.ownerType} attachment can only be attached once.`, 400);
    }
    const store = await loadStore();
    const desired = input.attachmentIds.map((attachmentId) => store.attachments[attachmentId]);
    if (
      desired.some(
        (record) =>
          !record ||
          record.ownerType !== input.ownerType ||
          record.status !== "uploaded" ||
          (record.actorHandle && record.actorHandle !== input.actorHandle) ||
          (record.ownerId && record.ownerId !== input.ownerId)
      )
    ) {
      throw new LocalAttachmentStoreError(
        `One or more attachments are not confirmed, no longer available, or already belong to another ${input.ownerType}.`,
        400
      );
    }

    const desiredIds = new Set(input.attachmentIds);
    const removed = Object.values(store.attachments).filter(
      (record) =>
        record.ownerType === input.ownerType && record.ownerId === input.ownerId && !desiredIds.has(record.attachmentId)
    );
    for (const record of removed) {
      await unlink(recordFilePath(record)).catch(() => undefined);
      delete store.attachments[record.attachmentId];
    }
    for (const record of desired as LocalAttachmentRecord[]) {
      store.attachments[record.attachmentId] = {
        ...record,
        ownerId: input.ownerId,
        updatedAt: new Date().toISOString()
      };
    }
    await saveStore(store);
    return input.attachmentIds.map((attachmentId) => localRecordToAttachment(store.attachments[attachmentId]!));
  });

export const deleteLocalOwnerAttachments = async (ownerType: "post" | "comment", ownerId: string) =>
  withStoreLock(async () => {
    const store = await loadStore();
    const owned = Object.values(store.attachments).filter(
      (record) => record.ownerType === ownerType && record.ownerId === ownerId
    );
    for (const record of owned) {
      await unlink(recordFilePath(record)).catch(() => undefined);
      delete store.attachments[record.attachmentId];
    }
    if (owned.length) await saveStore(store);
    return owned.length;
  });

export const resolveLocalPostAttachments = async (attachmentIds: string[], actorHandle?: string) => {
  const store = await loadStore();
  return attachmentIds.map((attachmentId): InquiryAttachment => {
    const record = store.attachments[attachmentId];
    if (
      !record ||
      record.ownerType !== "post" ||
      record.status !== "uploaded" ||
      Boolean(record.ownerId) ||
      (record.actorHandle && record.actorHandle !== actorHandle)
    ) {
      throw new LocalAttachmentStoreError(
        "One or more attachments are not confirmed, no longer available, or already belong to another post.",
        400
      );
    }
    return localRecordToAttachment(record);
  });
};
