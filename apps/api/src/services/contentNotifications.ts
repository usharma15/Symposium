import type { PoolClient } from "pg";
import type {
  ContentQuoteContract,
  VersionedDocumentContract
} from "../../../../packages/contracts/src";
import { cleanHandle } from "@/lib/symposiumCore";
import type { CreateNotificationInput } from "./notificationDelivery";

export type MentionNotificationSource = "post" | "comment" | "workspace_comment";

type MentionContent = {
  body: string;
  document?: VersionedDocumentContract;
};

type MentionNotificationInput = {
  sourceType: MentionNotificationSource;
  sourceId: string;
  postId?: string;
  noteId?: string;
  communityId?: string;
  actorHandle: string;
  actorName: string;
  body: string;
  href: string;
  current?: MentionContent;
  next: MentionContent;
  audienceHandles?: Iterable<string>;
};

type QuoteNotificationInput = {
  quote: ContentQuoteContract | undefined;
  quoteOwnerType: "post" | "comment";
  quoteOwnerId: string;
  quoteOwnerPostId: string;
  actorHandle: string;
  actorName: string;
  body: string;
  recipientCanRead: boolean;
  communityId?: string;
};

const inlineMentionPattern = /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9_]{1,79})(?![a-zA-Z0-9_])/g;

const documentRuns = (document?: VersionedDocumentContract) =>
  document?.nodes.flatMap((node) => {
    if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") {
      return node.content;
    }
    if (node.type === "list") return node.items.flat();
    return [];
  }) ?? [];

export const contentMentionHandles = ({ body, document }: MentionContent) => {
  const handles = new Set<string>();
  for (const match of body.matchAll(inlineMentionPattern)) {
    handles.add(cleanHandle(match[2]!));
  }
  for (const run of documentRuns(document)) {
    if (run.mentionHandle) handles.add(cleanHandle(run.mentionHandle));
    for (const match of run.text.matchAll(inlineMentionPattern)) {
      handles.add(cleanHandle(match[2]!));
    }
  }
  return [...handles].sort();
};

export const mentionHandleChanges = (
  current: MentionContent | undefined,
  next: MentionContent
) => {
  const currentHandles = new Set(current ? contentMentionHandles(current) : []);
  const nextHandles = new Set(contentMentionHandles(next));
  return {
    added: [...nextHandles].filter((handle) => !currentHandles.has(handle)),
    removed: [...currentHandles].filter((handle) => !nextHandles.has(handle))
  };
};

const existingProfileHandles = async (client: PoolClient, handles: string[]) => {
  if (!handles.length) return [];
  const result = await client.query<{ handle: string }>(
    "SELECT handle FROM profiles WHERE handle = ANY($1::text[])",
    [handles]
  );
  const existing = new Set(result.rows.map((row) => row.handle));
  return handles.filter((handle) => existing.has(handle));
};

const mentionKind = (sourceType: MentionNotificationSource) =>
  sourceType === "post"
    ? "post_mention"
    : sourceType === "comment"
      ? "comment_mention"
      : "workspace_mention";

const mentionLabel = (sourceType: MentionNotificationSource) =>
  sourceType === "post"
    ? "post"
    : sourceType === "comment"
      ? "comment"
      : "draft comment";

export const contentMentionNotificationInputs = async (
  client: PoolClient,
  input: MentionNotificationInput
): Promise<{
  inputs: CreateNotificationInput[];
  removedHandles: string[];
}> => {
  const changes = mentionHandleChanges(input.current, input.next);
  const audience = input.audienceHandles
    ? new Set([...input.audienceHandles].map(cleanHandle))
    : null;
  const candidateHandles = changes.added.filter((handle) =>
    handle !== input.actorHandle && (!audience || audience.has(handle))
  );
  const recipients = await existingProfileHandles(client, candidateHandles);
  const kind = mentionKind(input.sourceType);
  const label = mentionLabel(input.sourceType);
  const metadataBase = {
    actorHandle: input.actorHandle,
    mentionSourceType: input.sourceType,
    mentionSourceId: input.sourceId,
    ...(input.postId ? { postId: input.postId } : {}),
    ...(input.noteId ? { noteId: input.noteId } : {}),
    ...(input.communityId ? { communityId: input.communityId } : {}),
    ...(input.sourceType !== "post" ? { commentId: input.sourceId } : {})
  };
  return {
    inputs: recipients.map((profileHandle) => ({
      profileHandle,
      kind,
      title: `${input.actorName} mentioned you in a ${label}`,
      body: input.body,
      href: input.href,
      dedupeKey: `mention:${input.sourceType}:${input.sourceId}:${profileHandle}`,
      metadata: metadataBase
    })),
    removedHandles: changes.removed.filter((handle) => handle !== input.actorHandle)
  };
};

export const sameQuoteSource = (
  left: ContentQuoteContract | undefined,
  right: ContentQuoteContract | undefined
) => Boolean(
  left &&
  right &&
  left.sourceType === right.sourceType &&
  left.sourceId === right.sourceId
);

export const quoteAnalyticsSubjects = (
  ...quotes: Array<ContentQuoteContract | null | undefined>
) => {
  const subjects = new Map<string, {
    subjectType: "post" | "comment";
    postId: string;
    commentId?: string;
  }>();
  for (const quote of quotes) {
    if (!quote) continue;
    const subject = quote.sourceType === "post"
      ? { subjectType: "post" as const, postId: quote.sourceId }
      : {
          subjectType: "comment" as const,
          postId: quote.sourcePostId,
          commentId: quote.sourceId
        };
    const key = subject.subjectType === "post"
      ? `post:${subject.postId}`
      : `comment:${subject.postId}:${subject.commentId}`;
    subjects.set(key, subject);
  }
  return [...subjects.values()];
};

export const quoteNotificationInput = (
  input: QuoteNotificationInput
): CreateNotificationInput | null => {
  const recipient = input.quote?.authorHandle
    ? cleanHandle(input.quote.authorHandle)
    : null;
  if (
    !input.quote ||
    !input.quote.available ||
    !recipient ||
    recipient === input.actorHandle ||
    !input.recipientCanRead
  ) {
    return null;
  }
  const sourceLabel = input.quote.sourceType === "post" ? "post" : "comment";
  const href = input.quote.sourceType === "post"
    ? `/posts/${encodeURIComponent(input.quote.sourceId)}?analytics=quotes`
    : `/posts/${encodeURIComponent(input.quote.sourcePostId)}?comment=${encodeURIComponent(input.quote.sourceId)}&analytics=quotes`;
  return {
    profileHandle: recipient,
    kind: input.quote.sourceType === "post" ? "post_quote" : "comment_quote",
    title: `${input.actorName} quoted your ${sourceLabel}`,
    body: input.body,
    href,
    dedupeKey: `quote:${input.quoteOwnerType}:${input.quoteOwnerId}:${input.quote.sourceType}:${input.quote.sourceId}`,
    metadata: {
      actorHandle: input.actorHandle,
      sourceType: input.quote.sourceType,
      sourceId: input.quote.sourceId,
      sourcePostId: input.quote.sourcePostId,
      quoteOwnerType: input.quoteOwnerType,
      quoteOwnerId: input.quoteOwnerId,
      quoteOwnerPostId: input.quoteOwnerPostId,
      analyticsView: "quotes",
      ...(input.communityId ? { communityId: input.communityId } : {})
    }
  };
};
