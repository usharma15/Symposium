import type { ResearchProfile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import type {
  AttachmentKindContract,
  InquiryAttachmentContract,
  MessageContract
} from "@/packages/contracts/src";

export type MessageMediaKind = AttachmentKindContract | "links" | "starred";

const normalizedPersonSearch = (value: string) => value.trim().toLocaleLowerCase();

const personSearchRank = (person: ResearchProfile, query: string) => {
  const normalizedQuery = normalizedPersonSearch(query);
  const handle = cleanHandle(person.handle).toLocaleLowerCase();
  const name = person.name.trim().toLocaleLowerCase();
  const words = name.split(/\s+/).filter(Boolean);
  if (handle === cleanHandle(normalizedQuery)) return 0;
  if (name === normalizedQuery) return 1;
  if (handle.startsWith(cleanHandle(normalizedQuery))) return 2;
  if (name.startsWith(normalizedQuery)) return 3;
  if (words.some((word) => word.startsWith(normalizedQuery))) return 4;
  if (handle.includes(cleanHandle(normalizedQuery))) return 5;
  if (name.includes(normalizedQuery)) return 6;
  return 7;
};

export const rankMessagePeople = (
  people: ResearchProfile[],
  query: string,
  actorHandle: string,
  limit = 40
) => {
  const normalizedQuery = normalizedPersonSearch(query);
  if (!normalizedQuery) return [];
  const actor = cleanHandle(actorHandle);
  const byHandle = new Map<string, ResearchProfile>();
  for (const person of people) {
    const handle = cleanHandle(person.handle);
    if (!handle || handle === actor) continue;
    const searchable = `${person.name} ${person.handle}`.toLocaleLowerCase();
    if (!searchable.includes(normalizedQuery) && !handle.includes(cleanHandle(normalizedQuery))) continue;
    byHandle.set(handle, person);
  }
  return [...byHandle.values()]
    .sort((left, right) => personSearchRank(left, normalizedQuery) - personSearchRank(right, normalizedQuery)
      || left.name.localeCompare(right.name)
      || cleanHandle(left.handle).localeCompare(cleanHandle(right.handle)))
    .slice(0, Math.max(0, limit));
};

export const attachmentMatchesMessageMediaKind = (
  attachment: InquiryAttachmentContract,
  kind: MessageMediaKind
) => kind === "starred"
  || (kind === "document"
    ? ["pdf", "text", "document"].includes(attachment.kind)
    : kind !== "links" && attachment.kind === kind);

export const messageBodyLinks = (body: string) =>
  Array.from(new Set((body.match(/https?:\/\/[^\s<>()]+/giu) ?? [])
    .map((url) => url.replace(/[.,!?;:'"\]]+$/u, ""))
    .filter(Boolean)));

export const messageMediaResultCount = (messages: MessageContract[], kind: MessageMediaKind) => {
  if (kind === "links") return messages.reduce((total, message) => total + messageBodyLinks(message.body).length, 0);
  if (kind === "starred") return messages.length;
  return messages.reduce((total, message) => total
    + message.attachments.filter((attachment) => attachmentMatchesMessageMediaKind(attachment, kind)).length, 0);
};
