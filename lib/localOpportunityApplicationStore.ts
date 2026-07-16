import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpportunityApplicationContract } from "@/packages/contracts/src";
import { getSnapshot } from "@/lib/dataStore";
import {
  deleteLocalOwnerAttachments,
  localAttachmentsForOwner,
  replaceLocalOwnerAttachments
} from "@/lib/localAttachmentStore";

type StoredApplication = Omit<OpportunityApplicationContract, "attachments" | "comments"> & {
  comments: OpportunityApplicationContract["comments"];
};

type Store = { version: 1; applications: Record<string, StoredApplication> };
const root = path.join(process.cwd(), ".data", "opportunity-applications");
const indexPath = path.join(root, "index.json");
let queue: Promise<void> = Promise.resolve();

export class LocalOpportunityApplicationError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

const withLock = async <T>(operation: () => Promise<T>) => {
  const run = queue.then(operation, operation);
  queue = run.then(() => undefined, () => undefined);
  return run;
};

const load = async (): Promise<Store> => {
  await mkdir(root, { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf8")) as Partial<Store>;
    return { version: 1, applications: parsed.applications ?? {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, applications: {} };
    throw error;
  }
};

const save = async (store: Store) => {
  const temporary = `${indexPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporary, indexPath);
  } finally { await unlink(temporary).catch(() => undefined); }
};

const postFor = async (postId: string) => {
  const snapshot = await getSnapshot();
  const post = snapshot.items.find((item) => item.id === postId && !item.deletedAt && item.opportunity);
  if (!post) throw new LocalOpportunityApplicationError("Opportunity not found.", 404);
  return { post, snapshot };
};

const hydrate = async (application: StoredApplication, actorHandle: string): Promise<OpportunityApplicationContract> => ({
  ...application,
  attachments: await localAttachmentsForOwner("opportunity_application", application.id, actorHandle)
});

export const listLocalOpportunityApplications = async (postId: string, actorHandle: string) => {
  const { post } = await postFor(postId);
  if (post.authorHandle !== actorHandle) throw new LocalOpportunityApplicationError("Only the opportunity poster can review applications.", 403);
  const store = await load();
  const rows = Object.values(store.applications)
    .filter((application) => application.postId === postId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return Promise.all(rows.map((application) => hydrate(application, actorHandle)));
};

export const getOwnLocalOpportunityApplication = async (postId: string, actorHandle: string) => {
  await postFor(postId);
  const store = await load();
  const row = Object.values(store.applications).find((application) => application.postId === postId && application.applicantHandle === actorHandle);
  if (!row) return null;
  return { ...(await hydrate(row, actorHandle)), shortlisted: false, comments: [] };
};

export const createLocalOpportunityApplication = async (input: {
  postId: string;
  statement: string;
  attachmentIds: string[];
  actorHandle: string;
}) => withLock(async () => {
  const { post, snapshot } = await postFor(input.postId);
  if (post.authorHandle === input.actorHandle) throw new LocalOpportunityApplicationError("You cannot apply to your own opportunity.");
  if (post.opportunity?.status !== "open") throw new LocalOpportunityApplicationError("This opportunity is closed.");
  if (post.opportunity.deadline && post.opportunity.deadline < new Date().toISOString().slice(0, 10)) {
    throw new LocalOpportunityApplicationError("The application deadline has passed.");
  }
  const applicant = snapshot.profiles[input.actorHandle];
  if (!applicant) throw new LocalOpportunityApplicationError("Applicant profile not found.", 404);
  const store = await load();
  if (Object.values(store.applications).some((application) => application.postId === input.postId && application.applicantHandle === input.actorHandle)) {
    throw new LocalOpportunityApplicationError("You have already applied to this opportunity.", 409);
  }
  const now = new Date().toISOString();
  const row: StoredApplication = {
    id: randomUUID(),
    revision: 1,
    postId: input.postId,
    applicantHandle: input.actorHandle,
    applicantName: applicant.name,
    applicantAffiliation: applicant.location,
    statement: input.statement.trim(),
    shortlisted: false,
    comments: [],
    createdAt: now,
    updatedAt: now
  };
  await replaceLocalOwnerAttachments({ actorHandle: input.actorHandle, attachmentIds: input.attachmentIds, ownerId: row.id, ownerType: "opportunity_application" });
  store.applications[row.id] = row;
  await save(store);
  return hydrate(row, input.actorHandle);
});

export const updateLocalOpportunityApplication = async (input: {
  postId: string;
  applicationId: string;
  shortlisted: boolean;
  expectedRevision: number;
  actorHandle: string;
}) => withLock(async () => {
  const { post } = await postFor(input.postId);
  if (post.authorHandle !== input.actorHandle) throw new LocalOpportunityApplicationError("Only the opportunity poster can review applications.", 403);
  const store = await load();
  const current = store.applications[input.applicationId];
  if (!current || current.postId !== input.postId) throw new LocalOpportunityApplicationError("Application not found.", 404);
  if (current.revision !== input.expectedRevision) throw new LocalOpportunityApplicationError("This application changed. Refresh and try again.", 409);
  const updated = { ...current, shortlisted: input.shortlisted, revision: current.revision + 1, updatedAt: new Date().toISOString() };
  store.applications[input.applicationId] = updated;
  await save(store);
  return hydrate(updated, input.actorHandle);
});

export const addLocalOpportunityApplicationComment = async (input: {
  postId: string;
  applicationId: string;
  body: string;
  actorHandle: string;
}) => withLock(async () => {
  const { post, snapshot } = await postFor(input.postId);
  if (post.authorHandle !== input.actorHandle) throw new LocalOpportunityApplicationError("Only the opportunity poster can add private review notes.", 403);
  const store = await load();
  const current = store.applications[input.applicationId];
  if (!current || current.postId !== input.postId) throw new LocalOpportunityApplicationError("Application not found.", 404);
  const now = new Date().toISOString();
  const updated: StoredApplication = {
    ...current,
    comments: [...current.comments, {
      id: randomUUID(), applicationId: current.id, authorHandle: input.actorHandle,
      authorName: snapshot.profiles[input.actorHandle]?.name ?? input.actorHandle, body: input.body.trim(), createdAt: now
    }],
    updatedAt: now
  };
  store.applications[current.id] = updated;
  await save(store);
  return hydrate(updated, input.actorHandle);
});

export const deleteLocalOpportunityApplication = async (postId: string, applicationId: string, actorHandle: string) => withLock(async () => {
  const { post } = await postFor(postId);
  if (post.authorHandle !== actorHandle) throw new LocalOpportunityApplicationError("Only the opportunity poster can delete applications.", 403);
  const store = await load();
  const current = store.applications[applicationId];
  if (!current || current.postId !== postId) throw new LocalOpportunityApplicationError("Application not found.", 404);
  delete store.applications[applicationId];
  await save(store);
  await deleteLocalOwnerAttachments("opportunity_application", applicationId);
  return { id: applicationId, postId };
});

export const canAccessLocalOpportunityApplication = async (applicationId: string, actorHandle: string) => {
  const store = await load();
  const application = store.applications[applicationId];
  if (!application) return false;
  const { post } = await postFor(application.postId);
  return application.applicantHandle === actorHandle || post.authorHandle === actorHandle;
};

export const deleteLocalOpportunityApplicationsForPost = async (postId: string, actorHandle: string) => withLock(async () => {
  const { post } = await postFor(postId);
  if (post.authorHandle !== actorHandle) throw new LocalOpportunityApplicationError("Only the opportunity poster can delete its applications.", 403);
  const store = await load();
  const ids = Object.values(store.applications).filter((application) => application.postId === postId).map((application) => application.id);
  for (const id of ids) delete store.applications[id];
  if (ids.length) await save(store);
  await Promise.all(ids.map((id) => deleteLocalOwnerAttachments("opportunity_application", id)));
  return ids.length;
});
