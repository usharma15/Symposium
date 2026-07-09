"use client";

import Image from "next/image";
import { SignInButton, SignUpButton, useAuth, useUser } from "@clerk/nextjs";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Film,
  Fullscreen,
  Home,
  ImageIcon,
  MessageCircle,
  Moon,
  NotebookPen,
  Paperclip,
  Pencil,
  Repeat2,
  RotateCcw,
  Search,
  Send,
  Shrink,
  Sparkles,
  Settings,
  Sun,
  ThumbsUp,
  Trash2,
  UserRound,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  feedScopes,
  getProfileForName,
  inquiryItems,
  profile,
  researchCommunities,
  roomChips,
  rooms,
  type FeedScope,
  type InquiryAttachment,
  type InquiryComment,
  type InquiryItem,
  type ResearchCommunity,
  type ResearchProfile,
  type Room,
  type RoomId
} from "@/lib/mockData";
import type { CommentAction, PostAction } from "@/lib/dataStore";
import {
  attachmentKindForContentType,
  formatAttachmentBytes,
  inferAttachmentContentType,
  maxAttachmentPreviewTextLength,
  maxPostAttachments,
  postAttachmentAccept,
  splitPreviewTextIntoPages,
  validatePostAttachmentDetails
} from "@/lib/attachmentRules";
import {
  appendCommentToTree,
  cleanHandle,
  commentActionActive,
  commentMetricsFallback,
  countComments,
  deletedMetricLabel,
  deletedPostContextTitle,
  findCommentInTree,
  formatMetric,
  hasHandle,
  incrementMetric,
  isDeletedComment,
  isDeletedPost,
  itemTimestampScore,
  isSavedBy,
  localDateTimeLabel,
  mapCommentTree,
  metricNumber,
  mutateCommentForActor,
  mutateItemForActor,
  normalizeSearchPhrase,
  relativeTimeLabel,
  tombstoneComment,
  tombstonePost,
  updateSignalValue
} from "@/lib/symposiumCore";

type Theme = "day" | "night";
type ProfileTab = "all" | "papers" | "thoughts" | "comments" | "reshares" | "likes" | "saved";
type ProfileActivityKind = "authored" | "comments" | "fork" | "signal" | "save";
type ProfileCommentActivityKind = Exclude<ProfileActivityKind, "authored">;
type EntryMode = "loading" | "approach" | "auth" | "complete";
type OfficeMode = "desk" | "saved" | "notes";
type PatronageMode = "lobby" | "civic" | "private";
type CommentSegmentStacks = Record<string, string[]>;
type ToggleAction = Exclude<PostAction, "read">;
type ActionMetricKey = "signal" | "forks" | "saves" | "reads";
type ProtectedActionMetricState = {
  metric: ActionMetricKey;
  value: string;
  mode: "floor" | "ceiling";
};
type ViewTargetType = "post" | "comment";
type ViewTrigger = "visibility" | "click" | "expand";
type ViewSurface = "feed" | "profile" | "detail" | "thread" | "search" | "community";
type ViewActionOptions = {
  trigger?: ViewTrigger;
  surface?: ViewSurface;
};
type PostActionHandler = (itemId: string, action: PostAction, options?: ViewActionOptions) => void;
type AttachmentPreviewHandler = (item: InquiryItem, attachmentId: string) => void;
type CommentActionHandler = (
  itemId: string,
  commentId: string,
  action: CommentAction,
  options?: ViewActionOptions
) => void;
type EditingCommentTarget = {
  itemId: string;
  commentId: string;
};

type ViewSnapshot = {
  activeRoom: RoomId;
  selectedItemId: string | null;
  selectedCommentId: string | null;
  selectedProfileName: string | null;
  officeMode: OfficeMode;
  patronageMode: PatronageMode;
  selectedCommunityId: string | null;
  commentSegmentStacks: CommentSegmentStacks;
  scrollAnchor: { id: string; top: number; commentSegmentKey?: string; commentSegmentStack?: string[] } | null;
  scrollY: number;
};

type LocalSnapshot = {
  profiles: Record<string, ResearchProfile>;
  items: InquiryItem[];
};

type ProfileFollowRecord = {
  followerHandle?: string;
  followingHandle?: string;
  status?: string;
};

type ProfileFollowResponse = {
  following?: ProfileFollowRecord[];
  followers?: ProfileFollowRecord[];
};

type ProfileSocialLists = {
  following: string[];
  followers: string[];
};

type ProfileCommentActivity = {
  id: string;
  item: InquiryItem;
  comment: InquiryComment;
  kind: ProfileCommentActivityKind;
  label: string;
  recency: number;
};

type ProfileActivityEntry =
  | { id: string; type: "post"; item: InquiryItem; recency: number }
  | { id: string; type: "comment"; activity: ProfileCommentActivity; recency: number };

type ProfileActivitySlot =
  | { id: string; type: "post"; itemId: string; recency: number }
  | {
      id: string;
      type: "comment";
      itemId: string;
      commentId: string;
      kind: ProfileCommentActivityKind;
      label: string;
      recency: number;
    };

type PostDraft = {
  title: string;
  body: string;
  kind: Extract<InquiryItem["kind"], "paper" | "thought">;
  attachments: InquiryAttachment[];
};

type ProfileSettingsDraft = {
  avatarUrl?: string;
  name: string;
  bio: string;
  likesPublic: boolean;
  resharesPublic: boolean;
};

type AttachmentUploadResponse = {
  attachmentId?: string;
  uploadUrl?: string;
  publicUrl?: string | null;
};

type AttachmentPreviewTarget = {
  itemId: string;
  attachmentId: string;
};

type AttachmentRenderMode = "feed" | "detail" | "modal" | "expanded";

type MediaIntrinsicSize = {
  width: number;
  height: number;
};

type AttachmentViewportSize = {
  width: number;
  height: number;
};

type DocxPreviewRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

type DocxPreviewBlock = {
  id: string;
  runs: DocxPreviewRun[];
  style: "heading" | "paragraph" | "list";
};

type LiveEventPayload = {
  item?: unknown;
  follow?: ProfileFollowRecord;
  action?: PostAction;
  itemId?: string;
  commentId?: string;
};

type SymposiumLiveEvent = {
  id?: string;
  cursor?: string;
  kind: string;
  actorHandle?: string;
  subjectType: string;
  subjectId: string;
  payload?: LiveEventPayload;
  createdAt?: string;
};

type SymposiumAuthState = {
  clerkEnabled: boolean;
  authLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  signOut: () => Promise<void>;
};

const liveStatus = {
  loading: "Loading live data",
  connected: "Live data connected",
  reconnecting: "Live updates reconnecting",
  legacyConnected: "Live updates connected"
} as const;

const kindLabels: Record<InquiryItem["kind"], string> = {
  paper: "Paper",
  thought: "Thought",
  draft: "Draft",
  note: "Note",
  code: "Code"
};

const toggleActions: ToggleAction[] = ["save", "signal", "fork"];
const metricActions: PostAction[] = ["save", "signal", "fork", "read"];
const metricKeyForAction = (action: PostAction): ActionMetricKey => {
  if (action === "save") return "saves";
  if (action === "fork") return "forks";
  if (action === "read") return "reads";
  return "signal";
};

const metadataNumber = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
};

const metadataString = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
};

const metadataFiniteNumber = (metadata: Record<string, unknown> | undefined, key: string) => {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const clampUnit = (value: number | undefined, fallback = 0.5) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
};

const attachmentFocalStyle = (attachment: InquiryAttachment): CSSProperties => {
  const focalX = clampUnit(metadataFiniteNumber(attachment.metadata, "focalX"));
  const focalY = clampUnit(metadataFiniteNumber(attachment.metadata, "focalY"));
  return { objectPosition: `${focalX * 100}% ${focalY * 100}%` };
};

const attachmentMediaSize = (attachment: InquiryAttachment): MediaIntrinsicSize | null => {
  const width = metadataFiniteNumber(attachment.metadata, "width");
  const height = metadataFiniteNumber(attachment.metadata, "height");
  if (!width || !height || width <= 0 || height <= 0) return null;
  return { width, height };
};

const minAttachmentZoom = 0.1;
const maxAttachmentZoom = 5;
const zoomInStep = 0.2;
const zoomOutStep = 0.1;

const clampAttachmentZoom = (value: number) =>
  Math.min(maxAttachmentZoom, Math.max(minAttachmentZoom, Math.round(value * 100) / 100));

const fitMediaSizeToViewport = (
  intrinsicSize: MediaIntrinsicSize | null,
  viewportSize: AttachmentViewportSize | null,
  zoom: number
): MediaIntrinsicSize | null => {
  if (!intrinsicSize || !viewportSize || viewportSize.width <= 0 || viewportSize.height <= 0) return null;
  const fitScale = Math.min(
    viewportSize.width / intrinsicSize.width,
    viewportSize.height / intrinsicSize.height
  );
  return {
    width: Math.max(1, Math.round(intrinsicSize.width * fitScale * zoom)),
    height: Math.max(1, Math.round(intrinsicSize.height * fitScale * zoom))
  };
};

const attachmentPageCount = (attachment: InquiryAttachment, fallbackText = "") => {
  const metadataCount = metadataNumber(attachment.metadata, "pageCount");
  if (metadataCount) return metadataCount;
  if (fallbackText) return splitPreviewTextIntoPages(fallbackText).length;
  return 1;
};

const decodeXmlText = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");

const docxContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const isDocxAttachment = (attachment: InquiryAttachment) =>
  attachment.contentType.toLowerCase() === docxContentType ||
  attachment.fileName.toLowerCase().endsWith(".docx");

const extractDocxParagraphText = (paragraphXml: string) =>
  Array.from(paragraphXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeXmlText(match[1] ?? ""))
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();

const extractDocxPreviewTextFromXml = (documentXml: string) => {
  const paragraphs = Array.from(documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
    .map((match) => extractDocxParagraphText(match[0] ?? ""))
    .filter(Boolean);
  return paragraphs.join("\n\n").trim().slice(0, maxAttachmentPreviewTextLength);
};

const plainTextToDocxBlocks = (text: string): DocxPreviewBlock[] => {
  const normalized = text
    .replace(/\s+(?=(?:INTRODUCTION|BODY|CONCLUSION|Transition|Main Point|Thesis Statement|Credibility Statement)\b)/g, "\n\n")
    .trim();
  const chunks = normalized ? normalized.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean) : [];
  return chunks.map((chunk, index) => ({
    id: `plain-${index}`,
    runs: [{ text: chunk.replace(/\*\*/g, ""), bold: false, italic: false, underline: false }],
    style: /^(?:INTRODUCTION|BODY|CONCLUSION)\b/i.test(chunk) ? "heading" : "paragraph"
  }));
};

const paginateDocxBlocks = (blocks: DocxPreviewBlock[], pageSize = 2600) => {
  if (!blocks.length) return [[]] as DocxPreviewBlock[][];
  const pages: DocxPreviewBlock[][] = [];
  let current: DocxPreviewBlock[] = [];
  let currentLength = 0;

  blocks.forEach((block) => {
    const blockLength = block.runs.reduce((total, run) => total + run.text.length, 0);
    if (current.length && currentLength + blockLength > pageSize) {
      pages.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(block);
    currentLength += blockLength;
  });

  if (current.length) pages.push(current);
  return pages;
};

const extractDocxMetadata = async (file: File) => {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const appXml = await zip.file("docProps/app.xml")?.async("text");
  const documentXml = await zip.file("word/document.xml")?.async("text");
  const pageMatch = appXml?.match(/<Pages>(\d+)<\/Pages>/i);
  const pageCount = pageMatch ? Number(pageMatch[1]) : undefined;
  const previewText = documentXml ? extractDocxPreviewTextFromXml(documentXml) : "";

  return {
    ...(pageCount && Number.isFinite(pageCount) ? { pageCount } : {}),
    ...(previewText ? { previewText } : {})
  };
};

const extractPdfMetadata = async (file: File) => {
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder("latin1").decode(bytes);
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length ? { pageCount: matches.length } : {};
};

const extractTextMetadata = async (file: File) => {
  const text = (await file.text()).slice(0, maxAttachmentPreviewTextLength);
  return {
    pageCount: splitPreviewTextIntoPages(text).length,
    previewText: text
  };
};

const centeredMediaMetadata = (width: number, height: number, extra: Record<string, unknown> = {}) => ({
  width,
  height,
  focalX: 0.5,
  focalY: 0.5,
  ...extra
});

const extractImageMetadata = async (file: File) =>
  new Promise<Record<string, unknown>>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = document.createElement("img");
    const finish = (metadata: Record<string, unknown>) => {
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    image.onload = () =>
      finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? centeredMediaMetadata(image.naturalWidth, image.naturalHeight) : {});
    image.onerror = () => finish({});
    image.src = url;
  });

const extractVideoMetadata = async (file: File) =>
  new Promise<Record<string, unknown>>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const finish = (metadata: Record<string, unknown>) => {
      URL.revokeObjectURL(url);
      resolve(metadata);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      finish(
        video.videoWidth > 0 && video.videoHeight > 0
          ? centeredMediaMetadata(video.videoWidth, video.videoHeight, {
              ...(Number.isFinite(video.duration) ? { duration: video.duration } : {})
            })
          : {}
      );
    video.onerror = () => finish({});
    video.src = url;
  });

const buildPostAttachmentMetadata = async (file: File, contentType: string) => {
  try {
    if (contentType.startsWith("image/")) return extractImageMetadata(file);
    if (contentType.startsWith("video/")) return extractVideoMetadata(file);
    if (contentType === "application/pdf") return extractPdfMetadata(file);
    if (contentType.startsWith("text/") || contentType === "application/json") return extractTextMetadata(file);
    if (contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return extractDocxMetadata(file);
    }
  } catch {
    return {};
  }
  return {};
};

const startAttachmentDrag = (attachment: InquiryAttachment) => (event: React.DragEvent<HTMLElement>) => {
  if (!attachment.url) return;
  const url = new URL(attachment.url, window.location.href).toString();
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("DownloadURL", `${attachment.contentType}:${attachment.fileName}:${url}`);
};

const entranceRenders: Record<Theme, string> = {
  day: "/symposium-renders/entrance.png",
  night: "/symposium-renders/entrance-night.png"
};

const roomRenders: Record<Theme, Record<RoomId, string>> = {
  day: {
    hall: "/symposium-renders/main-hall-updated.png",
    office: "/symposium-renders/office.png",
    symposium: "/symposium-renders/symposium.png",
    library: "/symposium-renders/library-1.png",
    amphitheater: "/symposium-renders/amphitheatre-2.png",
    funding: "/symposium-renders/patronage.png",
    communities: "/symposium-renders/communities.png",
    opportunities: "/symposium-renders/opportunities.png"
  },
  night: {
    hall: "/symposium-renders/main-hall-night.png",
    office: "/symposium-renders/office-night.png",
    symposium: "/symposium-renders/symposium-night.png",
    library: "/symposium-renders/library-night.png",
    amphitheater: "/symposium-renders/amphitheatre-night.png",
    funding: "/symposium-renders/patronage-night.png",
    communities: "/symposium-renders/communities-night.png",
    opportunities: "/symposium-renders/opportunities-night.png"
  }
};

const patronageRenders: Record<Theme, Record<PatronageMode, string>> = {
  day: {
    lobby: "/symposium-renders/patronage.png",
    civic: "/symposium-renders/patronage-civic.png",
    private: "/symposium-renders/patronage-private.png"
  },
  night: {
    lobby: "/symposium-renders/patronage-night.png",
    civic: "/symposium-renders/patronage-civic-night.png",
    private: "/symposium-renders/patronage-private-night.png"
  }
};

const communityRenders: Record<Theme, { directory: string; selected: string }> = {
  day: {
    directory: "/symposium-renders/communities.png",
    selected: "/symposium-renders/community-selected.png"
  },
  night: {
    directory: "/symposium-renders/communities-night.png",
    selected: "/symposium-renders/community-selected-night.png"
  }
};

const preloadRenders = Array.from(
  new Set([
    ...Object.values(entranceRenders),
    ...Object.values(roomRenders.day),
    ...Object.values(roomRenders.night),
    ...Object.values(patronageRenders.day),
    ...Object.values(patronageRenders.night),
    ...Object.values(communityRenders.day),
    ...Object.values(communityRenders.night)
  ])
);

const getThemePreloadRenders = (theme: Theme) =>
  Array.from(
    new Set([
      entranceRenders[theme],
      ...Object.values(roomRenders[theme]),
      ...Object.values(patronageRenders[theme]),
      ...Object.values(communityRenders[theme])
    ])
  );

const getRoom = (roomId: RoomId) => rooms.find((room) => room.id === roomId) ?? rooms[0];

const topicTerms: Record<string, string[]> = {
  "Frontier Physics": ["physics", "hidden", "oscillator", "law", "apparatus"],
  "AI Metascience": ["ai", "agent", "agents", "metascience", "benchmark", "simulation"],
  "Rogue Youth Labs": ["youth lab", "youth labs", "pilot", "proof-of-work"],
  "History Of Discovery": ["history", "discovery", "accident", "anomaly", "prepared"],
  "Tools And Instruments": ["tool", "tools", "code", "instrument", "runner", "notebook"],
  Patronage: ["funding", "grant", "backer", "budget", "patronage", "civic", "private"],
  Communities: ["community", "communities", "events", "calls", "groups"],
  Opportunities: ["opportunity", "opportunities", "call", "fellowship", "role", "residency"]
};

const patronageTerms: Record<Exclude<PatronageMode, "lobby">, string[]> = {
  civic: ["civic", "crowdfund", "crowdfunding", "bounty", "bounties", "donation", "donations", "microgrant", "microgrants", "public", "stipend", "stipends"],
  private: ["private", "investor", "investors", "grant", "grants", "family office", "funds", "patron", "patronage", "backer", "backers", "tranche"]
};

const commentSearchText = (comments: InquiryComment[]): string =>
  comments
    .flatMap((comment) =>
      isDeletedComment(comment)
        ? [commentSearchText(comment.replies ?? [])]
        : [
            comment.author,
            comment.stance,
            comment.body,
            commentSearchText(comment.replies ?? [])
          ]
    )
    .join(" ");

const searchableText = (item: InquiryItem) =>
  [
    item.title,
    item.author,
    item.affiliation,
    item.status,
    item.excerpt,
    item.body,
    ...item.tags,
    ...item.claims,
    ...item.objections,
    ...item.evidence,
    ...item.tests,
    ...item.forks,
    commentSearchText(item.comments)
  ]
    .join(" ")
    .toLowerCase();

const searchableContentText = (item: InquiryItem) =>
  [
    item.author,
    item.affiliation,
    item.status,
    item.excerpt,
    item.body,
    ...item.tags,
    ...item.claims,
    ...item.objections,
    ...item.evidence,
    ...item.tests,
    ...item.forks,
    commentSearchText(item.comments)
  ]
    .join(" ")
    .toLowerCase();

const matchesTopic = (item: InquiryItem, chip: string) => {
  const terms = topicTerms[chip] ?? [];
  const text = searchableText(item);
  return terms.some((term) => text.includes(term));
};

const matchesPatronageMode = (item: InquiryItem, mode: PatronageMode) => {
  if (mode === "lobby") return false;
  const text = searchableText(item);
  return patronageTerms[mode].some((term) => {
    if (term.includes(" ")) return text.includes(term);
    return new RegExp(`\\b${term}\\b`, "i").test(text);
  });
};

const matchesCommunity = (item: InquiryItem, community: ResearchCommunity) => {
  const text = searchableText(item);
  return community.keywords.some((keyword) => text.includes(normalizeSearchPhrase(keyword)));
};

const getCommunityItems = (items: InquiryItem[], community: ResearchCommunity) =>
  items.filter((item) => !isDeletedPost(item) && matchesCommunity(item, community));

const getCommunityStats = (items: InquiryItem[], community: ResearchCommunity) => {
  const communityItems = getCommunityItems(items, community);
  const papers = communityItems.filter((item) => item.kind === "paper").length;
  const thoughts = communityItems.filter((item) => item.kind === "thought" || item.kind === "note").length;
  const opportunities = communityItems.filter((item) => item.room === "opportunities").length;

  return {
    papers: Math.max(papers, community.seedCounts.papers),
    thoughts: Math.max(thoughts, community.seedCounts.thoughts),
    opportunities: Math.max(opportunities, community.seedCounts.opportunities)
  };
};

const communitySearchText = (community: ResearchCommunity) =>
  normalizeSearchPhrase(
    [
      community.name,
      community.field,
      community.summary,
      community.visibility,
      community.callStatus,
      ...community.keywords
    ].join(" ")
  );

const clientId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const commentSegmentStackKey = (itemId: string, rootCommentId?: string | null) =>
  `${itemId}:${rootCommentId ?? "root-comment"}`;

const commentRootStackKey = (itemId: string, comment: InquiryComment, index: number) =>
  commentSegmentStackKey(
    itemId,
    comment.id ??
      `root-${index}-${comment.createdAt ?? "seeded"}-${comment.authorHandle ?? comment.author}-${comment.body
        .replace(/\s+/g, " ")
        .slice(0, 80)}`
  );

const cloneCommentSegmentStacks = (stacks: CommentSegmentStacks): CommentSegmentStacks =>
  Object.fromEntries(Object.entries(stacks).map(([key, stack]) => [key, [...stack]]));

const parseCommentSegmentStack = (value: string | undefined) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
};

const collapsedBodyLength = 500;
const bodyExpansionStep = 2000;
const actionStateProtectionMs = 5000;
const qualifiedViewVisibleRatio = 0.6;
const qualifiedViewDelayMs = 5000;
const viewDedupeWindowMs = 60 * 60 * 1000;

function useQualifiedView<T extends Element>(
  targetRef: RefObject<T | null>,
  {
    disabled = false,
    targetKey,
    onView
  }: {
    disabled?: boolean;
    targetKey?: string | null;
    onView: () => void;
  }
) {
  const onViewRef = useRef(onView);

  useEffect(() => {
    onViewRef.current = onView;
  }, [onView]);

  useEffect(() => {
    if (disabled || !targetKey || typeof IntersectionObserver === "undefined") return;

    const element = targetRef.current;
    if (!element) return;

    let viewTimer: number | null = null;
    const clearViewTimer = () => {
      if (viewTimer === null) return;
      window.clearTimeout(viewTimer);
      viewTimer = null;
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && entry.intersectionRatio >= qualifiedViewVisibleRatio) {
          if (viewTimer === null) {
            viewTimer = window.setTimeout(() => {
              viewTimer = null;
              onViewRef.current();
            }, qualifiedViewDelayMs);
          }
          return;
        }

        clearViewTimer();
      },
      { threshold: [0, qualifiedViewVisibleRatio, 1] }
    );

    observer.observe(element);
    return () => {
      clearViewTimer();
      observer.disconnect();
    };
  }, [disabled, targetKey, targetRef]);
}

function useSymposiumRenderPreload(primaryRenders: string[], activeRender: string) {
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;

    const cache = imageCacheRef.current;
    const preloadSource = (source: string, priority: "high" | "low") => {
      if (cache[source]) return;
      const image = new window.Image();
      image.decoding = "async";
      image.setAttribute("fetchpriority", priority);
      image.src = source;
      cache[source] = image;
    };

    const urgentRenders = Array.from(new Set([activeRender, ...primaryRenders]));
    urgentRenders.forEach((source) => preloadSource(source, "high"));

    const remainingRenders = preloadRenders.filter((source) => !urgentRenders.includes(source));
    const preloadRemainingRenders = () => {
      remainingRenders.forEach((source) => preloadSource(source, "low"));
    };
    const idleWindow = window as Window &
      typeof globalThis & {
        requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
        cancelIdleCallback?: (handle: number) => void;
      };

    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(preloadRemainingRenders, { timeout: 2500 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }

    const timeoutId = window.setTimeout(preloadRemainingRenders, 900);
    return () => window.clearTimeout(timeoutId);
  }, [activeRender, primaryRenders]);
}

function RenderPreloadDeck({ sources }: { sources: string[] }) {
  return (
    <div className="render-preload" aria-hidden="true">
      {sources.map((render) => (
        <Image key={render} src={render} alt="" width={1} height={1} loading="eager" unoptimized />
      ))}
    </div>
  );
}

const findCommentById = (comments: InquiryComment[], id: string): InquiryComment | undefined => {
  return findCommentInTree(comments, id) ?? undefined;
};

const findCommentPathById = (comments: InquiryComment[], id: string): InquiryComment[] | null => {
  for (const comment of comments) {
    if (comment.id === id) return [comment];
    const childPath = findCommentPathById(comment.replies ?? [], id);
    if (childPath) return [comment, ...childPath];
  }
  return null;
};

const commentAuthoredByProfile = (comment: InquiryComment, person: ResearchProfile) =>
  !isDeletedComment(comment) &&
  (comment.authorHandle ? cleanHandle(comment.authorHandle) === person.handle : comment.author === person.name);

const commentTimestampScore = (comment: InquiryComment) => {
  const parsed = comment.createdAt ? Date.parse(comment.createdAt) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
};

const profileCommentActivityLabels: Record<ProfileCommentActivityKind, string> = {
  comments: "Comment",
  fork: "Reshared comment",
  signal: "Liked comment",
  save: "Saved comment"
};

const commentMatchesProfileActivity = (
  comment: InquiryComment,
  person: ResearchProfile,
  kind: ProfileCommentActivityKind
) => {
  if (isDeletedComment(comment)) return false;
  if (kind === "comments") return commentAuthoredByProfile(comment, person);
  if (kind === "fork") return hasHandle(comment.forkedBy, person.handle);
  if (kind === "signal") return hasHandle(comment.signaledBy, person.handle);
  if (kind === "save") return hasHandle(comment.savedBy, person.handle);
  return false;
};

const collectProfileComments = (
  items: InquiryItem[],
  person: ResearchProfile,
  kind: ProfileCommentActivityKind = "comments",
  recencyForComment?: (item: InquiryItem, comment: InquiryComment, kind: ProfileCommentActivityKind) => number
): ProfileCommentActivity[] => {
  const activities: ProfileCommentActivity[] = [];

  const visit = (item: InquiryItem, comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (commentMatchesProfileActivity(comment, person, kind) && comment.id) {
        activities.push({
          id: `${kind}:${item.id}:${comment.id}`,
          item,
          comment,
          kind,
          label: profileCommentActivityLabels[kind],
          recency:
            recencyForComment?.(item, comment, kind) ??
            (commentTimestampScore(comment) || itemTimestampScore(item))
        });
      }
      visit(item, comment.replies ?? []);
    }
  };

  for (const item of items) visit(item, item.comments);
  return activities.sort((a, b) => b.recency - a.recency);
};

const updateCommentsForProfile = (
  comments: InquiryComment[],
  person: ResearchProfile
): InquiryComment[] =>
  comments.map((comment) => ({
    ...comment,
    author:
      !isDeletedComment(comment) && comment.authorHandle && cleanHandle(comment.authorHandle) === person.handle
        ? person.name
        : comment.author,
    replies: updateCommentsForProfile(comment.replies ?? [], person)
  }));

const itemAuthoredByProfile = (item: InquiryItem, person: ResearchProfile) =>
  !isDeletedPost(item) && (item.authorHandle ? item.authorHandle === person.handle : item.author === person.name);

const isLiveInquiryItem = (value: unknown): value is InquiryItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as InquiryItem).id === "string" &&
  typeof (value as InquiryItem).title === "string" &&
  typeof (value as InquiryItem).kind === "string" &&
  typeof (value as InquiryItem).room === "string" &&
  typeof (value as InquiryItem).metrics === "object";

const profileForHandle = (profiles: Record<string, ResearchProfile>, handleOrName?: string) => {
  if (!handleOrName) return undefined;
  return profiles[cleanHandle(handleOrName)] ?? Object.values(profiles).find((person) => person.name === handleOrName);
};

const inferredLikesPublic = (person: ResearchProfile) => person.likesPublic ?? person.handle.length % 5 !== 0;
const inferredResharesPublic = (person: ResearchProfile) => person.resharesPublic ?? person.handle.length % 4 !== 0;

const fallbackCommunityCount = 8;
const commentsSectionTargetId = "__symposium-comments-section__";
const clientSeedItemById = new Map(inquiryItems.map((item) => [item.id, item]));
const clientSeedCommentById = new Map<string, InquiryComment>();
for (const item of inquiryItems) {
  const visit = (comments: InquiryComment[]) => {
    for (const comment of comments) {
      if (comment.id) clientSeedCommentById.set(comment.id, comment);
      visit(comment.replies ?? []);
    }
  };
  visit(item.comments);
}

const legacyLiveSeedCreatedAt = (id?: string, offsetMinutes = 0) => {
  const match = id?.match(/^live-(\d+)-/);
  if (!match) return undefined;
  const index = Number(match[1]);
  if (!Number.isFinite(index)) return undefined;
  return new Date(Date.UTC(2026, 5, 18, 12, 0, 0) - (index * 19 + offsetMinutes) * 60 * 1000).toISOString();
};

const stableSeedCreatedAt = (createdAt: string | undefined, fallback?: string) => {
  if (createdAt && !Number.isNaN(Date.parse(createdAt))) return createdAt;
  return fallback ?? createdAt;
};

const normalizeClientSeedCommentTimes = (comments: InquiryComment[]): InquiryComment[] =>
  comments.map((comment) => ({
    ...comment,
    createdAt: stableSeedCreatedAt(
      comment.id ? clientSeedCommentById.get(comment.id)?.createdAt ?? comment.createdAt : comment.createdAt,
      legacyLiveSeedCreatedAt(comment.id, 1)
    ),
    replies: normalizeClientSeedCommentTimes(comment.replies ?? [])
  }));

const normalizeClientSeedTimes = (items: InquiryItem[]): InquiryItem[] =>
  items.map((item) => {
    const seedItem = clientSeedItemById.get(item.id);
    return {
      ...item,
      createdAt: stableSeedCreatedAt(seedItem?.createdAt ?? item.createdAt, legacyLiveSeedCreatedAt(item.id)),
      comments: normalizeClientSeedCommentTimes(item.comments ?? [])
    };
  });

const normalizeClientItem = (item: InquiryItem) => normalizeClientSeedTimes([item])[0] ?? item;

const preservePublishedPosition = (incoming: InquiryItem, existing?: InquiryItem): InquiryItem => {
  const normalized = normalizeClientItem(incoming);
  if (!existing) return normalized;

  return {
    ...normalized,
    date: existing.date,
    createdAt: existing.createdAt,
    attachments: normalized.attachments ?? existing.attachments
  };
};

const maxVisibleCommentPathLength = 6;

const communityMembershipIds = (communities: ResearchCommunity[], person: ResearchProfile) => {
  const explicit = communities.filter((community) => community.memberHandles.includes(person.handle));
  if (explicit.length > 0) return new Set(explicit.map((community) => community.id));

  const maxOffset = Math.max(1, communities.length - fallbackCommunityCount + 1);
  const offset =
    Array.from(person.handle).reduce((total, character) => total + character.charCodeAt(0), 0) % maxOffset;
  const fallback = communities.slice(offset, offset + fallbackCommunityCount);
  return new Set(fallback.map((community) => community.id));
};

const initial = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const localPreviewAuth: SymposiumAuthState = {
  clerkEnabled: false,
  authLoaded: true,
  isSignedIn: false,
  userId: null,
  signOut: async () => undefined
};

export function SymposiumV0({ clerkEnabled = false }: { clerkEnabled?: boolean }) {
  if (clerkEnabled) return <ClerkSymposiumV0 />;
  return <SymposiumExperience auth={localPreviewAuth} />;
}

function ClerkSymposiumV0() {
  const { isLoaded: authLoaded, isSignedIn, signOut: clerkSignOut } = useAuth();
  const { user } = useUser();

  return (
    <SymposiumExperience
      auth={{
        clerkEnabled: true,
        authLoaded,
        isSignedIn: Boolean(isSignedIn),
        userId: user?.id ?? null,
        signOut: async () => {
          await clerkSignOut();
        }
      }}
    />
  );
}

function SymposiumExperience({ auth }: { auth: SymposiumAuthState }) {
  const { authLoaded, clerkEnabled, isSignedIn, userId } = auth;
  const [theme, setTheme] = useState<Theme>("day");
  const [entryMode, setEntryMode] = useState<EntryMode>("loading");
  const [signedIn, setSignedIn] = useState(false);
  const [activeRoom, setActiveRoom] = useState<RoomId>("hall");
  const [items, setItems] = useState<InquiryItem[]>(inquiryItems);
  const [profiles, setProfiles] = useState<Record<string, ResearchProfile>>({});
  const [currentProfile, setCurrentProfile] = useState<ResearchProfile>(profile);
  const [followingHandles, setFollowingHandles] = useState<string[]>([]);
  const [profileSocialLists, setProfileSocialLists] = useState<Record<string, ProfileSocialLists>>({});
  const [feedScope, setFeedScope] = useState<FeedScope>("suggested");
  const [roomChip, setRoomChip] = useState(roomChips[0]);
  const [officeMode, setOfficeMode] = useState<OfficeMode>("desk");
  const [patronageMode, setPatronageMode] = useState<PatronageMode>("lobby");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [commentSegmentStacks, setCommentSegmentStacks] = useState<CommentSegmentStacks>({});
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [communitiesExpanded, setCommunitiesExpanded] = useState(false);
  const [communityQuery, setCommunityQuery] = useState("");
  const [tabletOpen, setTabletOpen] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProfileName, setSelectedProfileName] = useState<string | null>(null);
  const [viewHistory, setViewHistory] = useState<ViewSnapshot[]>([]);
  const [viewFuture, setViewFuture] = useState<ViewSnapshot[]>([]);
  const [profileActiveTabs, setProfileActiveTabs] = useState<Record<string, ProfileTab>>({});
  const [profileActivityRevision, setProfileActivityRevision] = useState(0);
  const [editingPost, setEditingPost] = useState<InquiryItem | null>(null);
  const [editingComment, setEditingComment] = useState<EditingCommentTarget | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<AttachmentPreviewTarget | null>(null);
  const [activityRecency, setActivityRecency] = useState<Record<string, number>>({});
  const [syncStatus, setSyncStatus] = useState<string>(liveStatus.loading);
  const [authError, setAuthError] = useState("");
  const itemsRef = useRef(items);
  const profilesRef = useRef(profiles);
  const currentProfileRef = useRef(currentProfile);
  const selectedProfileNameRef = useRef(selectedProfileName);
  const selectedItemIdRef = useRef(selectedItemId);
  const selectedCommentIdRef = useRef(selectedCommentId);
  const commentSegmentStacksRef = useRef<CommentSegmentStacks>({});
  const visibleCommentSegmentStacksRef = useRef<CommentSegmentStacks>({});
  const actionVersionsRef = useRef<Record<string, number>>({});
  const actionDesiredStateRef = useRef<Record<string, boolean | undefined>>({});
  const actionMetricStateRef = useRef<Record<string, ProtectedActionMetricState>>({});
  const actionProtectionUntilRef = useRef<Record<string, number>>({});
  const viewDedupeRef = useRef<Record<string, number>>({});
  const activityRecencyRef = useRef(activityRecency);
  const pendingActivityRecencyRef = useRef<Record<string, number>>({});
  const liveEventCursorRef = useRef("");
  const liveRefreshTimerRef = useRef<number | null>(null);
  const [syncedClerkUserId, setSyncedClerkUserId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState(
    "First note: make the thing feel alive without pretending the whole world is built yet."
  );

  const activeRoomData = getRoom(activeRoom);
  const themedRoomRenders = roomRenders[theme];
  const themedPatronageRenders = patronageRenders[theme];
  const themedCommunityRenders = communityRenders[theme];
  const activeRoomRender =
    activeRoom === "funding"
      ? themedPatronageRenders[patronageMode]
      : activeRoom === "communities" && selectedCommunityId
        ? themedCommunityRenders.selected
        : themedRoomRenders[activeRoom];
  const themePreloadRenders = useMemo(() => getThemePreloadRenders(theme), [theme]);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const attachmentPreviewItem = attachmentPreview
    ? items.find((item) => item.id === attachmentPreview.itemId) ?? null
    : null;
  const activeItems = useMemo(() => items.filter((item) => !isDeletedPost(item)), [items]);
  const editingPostItem = editingPost ? items.find((item) => item.id === editingPost.id) ?? editingPost : null;
  const editingCommentItem = editingComment ? items.find((item) => item.id === editingComment.itemId) ?? null : null;
  const editingCommentValue =
    editingComment && editingCommentItem
      ? findCommentById(editingCommentItem.comments, editingComment.commentId) ?? null
      : null;
  const selectedCommunity =
    selectedCommunityId ? researchCommunities.find((community) => community.id === selectedCommunityId) ?? null : null;
  const profileList = useMemo(() => Object.values(profiles), [profiles]);
  const findProfile = (nameOrHandle: string) =>
    profileList.find((person) => person.handle === nameOrHandle) ??
    profileList.find((person) => person.name === nameOrHandle) ??
    getProfileForName(nameOrHandle);
  const selectedProfile = selectedProfileName ? findProfile(selectedProfileName) : null;

  useSymposiumRenderPreload(themePreloadRenders, activeRoomRender);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  useEffect(() => {
    currentProfileRef.current = currentProfile;
  }, [currentProfile]);

  const clientViewStorageKey = (handle: string) => `symposium-view-dedupe:${cleanHandle(handle)}`;
  const clientViewKey = (targetType: ViewTargetType, targetId: string) => `${targetType}:${targetId}`;
  const pruneClientViewDedupe = (dedupe: Record<string, number>, now = Date.now()) =>
    Object.fromEntries(
      Object.entries(dedupe).filter(([, timestamp]) => Number.isFinite(timestamp) && now - timestamp < viewDedupeWindowMs)
    );
  const persistClientViewDedupe = (dedupe: Record<string, number>, handle = currentProfileRef.current.handle) => {
    const pruned = pruneClientViewDedupe(dedupe);
    viewDedupeRef.current = pruned;
    window.localStorage.setItem(clientViewStorageKey(handle), JSON.stringify(pruned));
  };
  const readClientViewDedupe = (handle: string) => {
    try {
      const raw = window.localStorage.getItem(clientViewStorageKey(handle));
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, number>;
      return pruneClientViewDedupe(parsed);
    } catch {
      return {};
    }
  };
  const claimClientView = (targetType: ViewTargetType, targetId: string) => {
    const now = Date.now();
    const key = clientViewKey(targetType, targetId);
    const dedupe = pruneClientViewDedupe(viewDedupeRef.current, now);
    const lastViewedAt = dedupe[key];
    if (Number.isFinite(lastViewedAt) && now - lastViewedAt < viewDedupeWindowMs) {
      viewDedupeRef.current = dedupe;
      return false;
    }

    dedupe[key] = now;
    persistClientViewDedupe(dedupe);
    return true;
  };
  const releaseClientViewClaim = (targetType: ViewTargetType, targetId: string) => {
    const key = clientViewKey(targetType, targetId);
    const rest = { ...viewDedupeRef.current };
    delete rest[key];
    persistClientViewDedupe(rest);
  };

  useEffect(() => {
    const dedupe = readClientViewDedupe(currentProfile.handle);
    viewDedupeRef.current = dedupe;
    persistClientViewDedupe(dedupe, currentProfile.handle);
  }, [currentProfile.handle]);

  useEffect(() => {
    selectedProfileNameRef.current = selectedProfileName;
  }, [selectedProfileName]);

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId;
  }, [selectedItemId]);

  useEffect(() => {
    selectedCommentIdRef.current = selectedCommentId;
  }, [selectedCommentId]);

  useEffect(() => {
    commentSegmentStacksRef.current = commentSegmentStacks;
  }, [commentSegmentStacks]);

  useEffect(() => {
    if (!selectedCommentId || selectedCommentId === commentsSectionTargetId) return;
    const highlightedCommentId = selectedCommentId;
    const timer = window.setTimeout(() => {
      setSelectedCommentId((current) => (current === highlightedCommentId ? null : current));
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [selectedCommentId]);

  useEffect(() => {
    activityRecencyRef.current = activityRecency;
  }, [activityRecency]);

  const getPublishedRecency = (item: InquiryItem) => itemTimestampScore(item);
  const profileActivityKey = (handle: string, action: PostAction, itemId: string) =>
    `profile:${cleanHandle(handle)}:${action}:${itemId}`;
  const profileCommentActivityKey = (
    handle: string,
    action: Exclude<ProfileCommentActivityKind, "comments">,
    itemId: string,
    commentId: string
  ) => `profile:${cleanHandle(handle)}:${action}:${itemId}:comment:${commentId}`;
  const getProfileRecency = (item: InquiryItem, handle: string, kind: ProfileActivityKind) => {
    if (kind === "authored") return getPublishedRecency(item);
    if (kind === "comments") return activityRecency[item.id] ?? getPublishedRecency(item);
    return activityRecency[profileActivityKey(handle, kind, item.id)] ?? getPublishedRecency(item);
  };
  const getProfileCommentRecency = (
    item: InquiryItem,
    comment: InquiryComment,
    handle: string,
    kind: ProfileCommentActivityKind
  ) => {
    if (kind === "comments" || !comment.id) {
      return commentTimestampScore(comment) || getPublishedRecency(item);
    }

    const fallbackRecency = commentTimestampScore(comment) || getPublishedRecency(item);
    return activityRecency[profileCommentActivityKey(handle, kind, item.id, comment.id)] ?? fallbackRecency;
  };
  const sortByPublishedRecency = (nextItems: InquiryItem[]) =>
    [...nextItems].sort((a, b) => getPublishedRecency(b) - getPublishedRecency(a));

  const visibleItems = useMemo(() => {
    const patronageItems = activeItems.filter((item) => item.room === "funding");
    const selectedPatronageItems =
      patronageMode === "lobby"
        ? []
        : patronageItems.filter((item) => matchesPatronageMode(item, patronageMode));
    const patronageFallbackItems =
      patronageMode === "lobby" || selectedPatronageItems.length ? selectedPatronageItems : patronageItems;
    const patronageIds = new Set(patronageFallbackItems.map((item) => item.id));

    const roomFiltered = activeItems
      .filter((item) => {
        if (activeRoom === "hall") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "office") {
          if (officeMode === "saved") return isSavedBy(item, currentProfile.handle, profile.handle);
          if (officeMode === "notes") {
            return itemAuthoredByProfile(item, currentProfile) || item.room === "office";
          }
          return false;
        }
        if (activeRoom === "symposium") return item.kind === "paper" || item.kind === "thought";
        if (activeRoom === "library") return item.kind === "paper";
        if (activeRoom === "amphitheater") return item.kind === "thought" || item.kind === "note";
        if (activeRoom === "funding") return patronageIds.has(item.id);
        if (activeRoom === "communities") return item.room === "communities";
        if (activeRoom === "opportunities") return item.room === "opportunities";
        return true;
      })
      .filter((item) => {
        if (feedScope === "following") {
          return (
            itemAuthoredByProfile(item, currentProfile) ||
            Boolean(item.authorHandle && followingHandles.includes(item.authorHandle)) ||
            isSavedBy(item, currentProfile.handle, profile.handle)
          );
        }
        if (feedScope === "rooms") return matchesTopic(item, roomChip);
        return true;
      });

    return sortByPublishedRecency(roomFiltered);
  }, [activeItems, activeRoom, currentProfile, feedScope, followingHandles, officeMode, patronageMode, roomChip]);

  const readLocalSnapshot = (): LocalSnapshot | null => {
    try {
      const raw = window.localStorage.getItem("symposium-local-snapshot");
      if (!raw) return null;
      const snapshot = JSON.parse(raw) as LocalSnapshot;
      return { ...snapshot, items: normalizeClientSeedTimes(snapshot.items ?? []) };
    } catch {
      return null;
    }
  };

  const persistLocalSnapshot = (
    nextItems = items,
    nextProfiles = profiles,
    nextProfile = currentProfile
  ) => {
    window.localStorage.setItem(
      "symposium-local-snapshot",
      JSON.stringify({ items: nextItems, profiles: nextProfiles })
    );
    window.localStorage.setItem("symposium-profile-handle", nextProfile.handle);
  };

  const followingStorageKey = (handle: string) => `symposium-following-${handle}`;

  const readLocalFollowing = (handle: string) => {
    try {
      const raw = window.localStorage.getItem(followingStorageKey(handle));
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      return parsed.map(cleanHandle).filter(Boolean);
    } catch {
      return [];
    }
  };

  const persistLocalFollowing = (handle: string, handles: string[]) => {
    window.localStorage.setItem(
      followingStorageKey(handle),
      JSON.stringify(Array.from(new Set(handles.map(cleanHandle).filter(Boolean))))
    );
  };

  const applySocialLists = (handle: string, lists: ProfileSocialLists) => {
    setProfileSocialLists((current) => ({
      ...current,
      [handle]: {
        following: Array.from(new Set(lists.following.map(cleanHandle).filter(Boolean))),
        followers: Array.from(new Set(lists.followers.map(cleanHandle).filter(Boolean)))
      }
    }));
  };

  const socialListsFromResponse = (data: ProfileFollowResponse): ProfileSocialLists => ({
    following: Array.from(
      new Set((data.following ?? []).map((follow) => cleanHandle(String(follow.followingHandle ?? ""))).filter(Boolean))
    ),
    followers: Array.from(
      new Set((data.followers ?? []).map((follow) => cleanHandle(String(follow.followerHandle ?? ""))).filter(Boolean))
    )
  });

  const markLiveDataConnected = () => {
    setSyncStatus((status) =>
      status === liveStatus.loading ||
      status === liveStatus.reconnecting ||
      status === liveStatus.legacyConnected
        ? liveStatus.connected
        : status
    );
  };

  const markLiveUpdatesReconnecting = () => {
    setSyncStatus((status) =>
      status === liveStatus.loading ||
      status === liveStatus.connected ||
      status === liveStatus.reconnecting ||
      status === liveStatus.legacyConnected
        ? liveStatus.reconnecting
        : status
    );
  };

  const setProtectedDesiredActionState = (
    key: string,
    desired: boolean | undefined,
    metricState?: ProtectedActionMetricState
  ) => {
    if (desired === undefined) delete actionDesiredStateRef.current[key];
    else actionDesiredStateRef.current[key] = desired;

    if (metricState) actionMetricStateRef.current[key] = metricState;
    else delete actionMetricStateRef.current[key];

    if (desired === undefined && !metricState) {
      delete actionProtectionUntilRef.current[key];
      return;
    }

    actionProtectionUntilRef.current[key] = Date.now() + actionStateProtectionMs;
  };

  const clearDesiredActionState = (key: string) => {
    delete actionDesiredStateRef.current[key];
    delete actionMetricStateRef.current[key];
    delete actionProtectionUntilRef.current[key];
  };

  const protectedDesiredActionState = (key: string) => {
    const desired = actionDesiredStateRef.current[key];
    if (desired === undefined) return undefined;

    const protectedUntil = actionProtectionUntilRef.current[key] ?? 0;
    if (protectedUntil >= Date.now()) return desired;

    clearDesiredActionState(key);
    return undefined;
  };

  const protectedActionMetricState = (key: string) => {
    const metricState = actionMetricStateRef.current[key];
    if (!metricState) return undefined;

    const protectedUntil = actionProtectionUntilRef.current[key] ?? 0;
    if (protectedUntil >= Date.now()) return metricState;

    clearDesiredActionState(key);
    return undefined;
  };

  const refreshData = async (preferredHandle = currentProfile.handle) => {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load Symposium data.");
    const data = (await response.json()) as {
      items: InquiryItem[];
      profiles: Record<string, ResearchProfile>;
      defaultProfile: ResearchProfile;
    };
    const loadedProfiles = Object.keys(data.profiles).length
      ? data.profiles
      : { [data.defaultProfile.handle]: data.defaultProfile };
    const nextProfile = loadedProfiles[preferredHandle] ?? loadedProfiles[data.defaultProfile.handle] ?? data.defaultProfile;

    const loadedItems = protectItemsFromStaleActionState(
      sortByPublishedRecency(normalizeClientSeedTimes(data.items)),
      nextProfile.handle
    );
    itemsRef.current = loadedItems;
    profilesRef.current = loadedProfiles;
    currentProfileRef.current = nextProfile;
    setItems(loadedItems);
    setProfiles(loadedProfiles);
    setCurrentProfile(nextProfile);
    persistLocalSnapshot(loadedItems, loadedProfiles, nextProfile);
    setSyncStatus(liveStatus.connected);
  };

  const refreshFollowing = async (actorHandle = currentProfile.handle) => {
    const cached = readLocalFollowing(actorHandle);
    if (cached.length) setFollowingHandles(cached);

    const response = await fetch(`/api/follows?actorHandle=${encodeURIComponent(actorHandle)}`, { cache: "no-store" });
    if (!response.ok) return;

    const data = (await response.json()) as ProfileFollowResponse;
    const lists = socialListsFromResponse(data);
    const remoteHandles = lists.following;

    setFollowingHandles(remoteHandles);
    applySocialLists(actorHandle, lists);
    persistLocalFollowing(actorHandle, remoteHandles);
  };

  const refreshProfileFollows = async (handle: string) => {
    const normalizedHandle = cleanHandle(handle);
    if (!normalizedHandle) return;

    const response = await fetch(`/api/profiles/${encodeURIComponent(normalizedHandle)}/follows`, { cache: "no-store" });
    if (!response.ok) return;

    const data = (await response.json()) as ProfileFollowResponse;
    applySocialLists(normalizedHandle, socialListsFromResponse(data));
  };

  const mergeLiveItem = (incoming: InquiryItem) => {
    const currentItems = itemsRef.current;
    const existingIndex = currentItems.findIndex((item) => item.id === incoming.id);
    const currentItem = existingIndex >= 0 ? currentItems[existingIndex] : undefined;
    const protectedIncoming = protectItemFromStaleActionState(incoming, currentItem, currentProfileRef.current.handle);
    const nextItem = preservePublishedPosition(protectedIncoming, currentItem);
    const nextItems =
      existingIndex >= 0
        ? currentItems.map((item) => (item.id === incoming.id ? nextItem : item))
        : sortByPublishedRecency([nextItem, ...currentItems]);

    itemsRef.current = nextItems;
    setItems(nextItems);
    persistLocalSnapshot(nextItems, profilesRef.current, currentProfileRef.current);
    return true;
  };

  const mergeLiveFollow = (record: ProfileFollowRecord | undefined, active: boolean) => {
    const followerHandle = cleanHandle(String(record?.followerHandle ?? ""));
    const followingHandle = cleanHandle(String(record?.followingHandle ?? ""));
    if (!followerHandle || !followingHandle || followerHandle === "@" || followingHandle === "@") return;

    setProfileSocialLists((current) => {
      const followerLists = current[followerHandle] ?? { following: [], followers: [] };
      const followingLists = current[followingHandle] ?? { following: [], followers: [] };
      const nextFollowerFollowing = active
        ? Array.from(new Set([...followerLists.following, followingHandle]))
        : followerLists.following.filter((handle) => handle !== followingHandle);
      const nextFollowingFollowers = active
        ? Array.from(new Set([...followingLists.followers, followerHandle]))
        : followingLists.followers.filter((handle) => handle !== followerHandle);

      return {
        ...current,
        [followerHandle]: { ...followerLists, following: nextFollowerFollowing },
        [followingHandle]: { ...followingLists, followers: nextFollowingFollowers }
      };
    });

    if (followerHandle === currentProfileRef.current.handle) {
      setFollowingHandles((currentHandles) => {
        const storedHandles = readLocalFollowing(followerHandle);
        const merged = Array.from(new Set([...currentHandles, ...storedHandles]));
        const next = active
          ? Array.from(new Set([...merged, followingHandle]))
          : merged.filter((handle) => handle !== followingHandle);
        persistLocalFollowing(followerHandle, next);
        return next;
      });
    }
  };

  const scheduleLiveRefresh = () => {
    if (liveRefreshTimerRef.current) return;

    liveRefreshTimerRef.current = window.setTimeout(() => {
      liveRefreshTimerRef.current = null;
      const handle = currentProfileRef.current.handle;
      refreshData(handle).catch(() => undefined);
      refreshFollowing(handle).catch(() => undefined);
      const selectedKey = selectedProfileNameRef.current;
      const selected = selectedKey
        ? profilesRef.current[selectedKey] ??
          Object.values(profilesRef.current).find((person) => person.name === selectedKey) ??
          getProfileForName(selectedKey)
        : null;
      if (selected?.handle) refreshProfileFollows(selected.handle).catch(() => undefined);
    }, 650);
  };

  const itemActionActive = (item: InquiryItem, action: PostAction, handle: string) => {
    if (action === "save") return isSavedBy(item, handle, profile.handle);
    if (action === "signal") return hasHandle(item.signaledBy, handle);
    if (action === "fork") return hasHandle(item.forkedBy, handle);
    return undefined;
  };

  const protectedMetricValue = (incomingValue: string, protection: ProtectedActionMetricState) => {
    const incomingMetric = metricNumber(incomingValue);
    const protectedMetric = metricNumber(protection.value);
    if (protection.mode === "floor" && incomingMetric < protectedMetric) return protection.value;
    if (protection.mode === "ceiling" && incomingMetric > protectedMetric) return protection.value;
    return incomingValue;
  };

  const actionMetricStateFromValues = (
    previousMetrics: Partial<Record<ActionMetricKey, string>>,
    nextMetrics: Partial<Record<ActionMetricKey, string>>,
    action: PostAction
  ): ProtectedActionMetricState => {
    const metric = metricKeyForAction(action);
    const previousValue = previousMetrics[metric] ?? "0";
    const nextValue = nextMetrics[metric] ?? previousValue;
    return {
      metric,
      value: nextValue,
      mode: metricNumber(nextValue) < metricNumber(previousValue) ? "ceiling" : "floor"
    };
  };

  const applyProtectedPostMetricState = (incoming: InquiryItem, current: InquiryItem | undefined, handle: string) => {
    if (isDeletedPost(incoming)) return incoming;

    let metrics = incoming.metrics;
    let signals = incoming.signals;
    let changed = false;

    for (const action of metricActions) {
      const protection = protectedActionMetricState(`${incoming.id}:${action}:${handle}`);
      if (!protection) continue;

      const protectedValue = current?.metrics[protection.metric] ?? protection.value;
      const nextValue = protectedMetricValue(metrics[protection.metric], { ...protection, value: protectedValue });
      if (nextValue === metrics[protection.metric]) continue;

      metrics = { ...metrics, [protection.metric]: nextValue };
      if (protection.metric === "forks") signals = updateSignalValue(signals, "Forks", nextValue);
      changed = true;
    }

    return changed ? { ...incoming, metrics, signals } : incoming;
  };

  const applyProtectedCommentMetricState = (
    itemId: string,
    incoming: InquiryComment,
    current: InquiryComment | undefined,
    handle: string
  ) => {
    if (!incoming.id || isDeletedComment(incoming)) return incoming;

    let metrics = { ...commentMetricsFallback, ...(incoming.metrics ?? {}) };
    let changed = false;

    for (const action of metricActions) {
      const protection = protectedActionMetricState(`${itemId}:${incoming.id}:${action}:${handle}`);
      if (!protection) continue;

      const currentMetrics = { ...commentMetricsFallback, ...(current?.metrics ?? {}) };
      const protectedValue = currentMetrics[protection.metric] ?? protection.value;
      const nextValue = protectedMetricValue(metrics[protection.metric], { ...protection, value: protectedValue });
      if (nextValue === metrics[protection.metric]) continue;

      metrics = { ...metrics, [protection.metric]: nextValue };
      changed = true;
    }

    return changed ? { ...incoming, metrics } : incoming;
  };

  const commentConflictsWithDesiredActionState = (
    itemId: string,
    comments: InquiryComment[],
    handle: string
  ): boolean =>
    comments.some((comment) => {
      if (isDeletedComment(comment)) return false;

      if (comment.id) {
        for (const action of toggleActions) {
          const key = `${itemId}:${comment.id}:${action}:${handle}`;
          const desired = protectedDesiredActionState(key);
          if (desired !== undefined && commentActionActive(comment, action, handle) !== desired) return true;
        }
      }

      return commentConflictsWithDesiredActionState(itemId, comment.replies ?? [], handle);
    });

  const conflictsWithDesiredActionState = (item: InquiryItem, handle: string) => {
    if (isDeletedPost(item)) return false;

    for (const action of toggleActions) {
      const key = `${item.id}:${action}:${handle}`;
      const desired = protectedDesiredActionState(key);
      if (desired !== undefined && itemActionActive(item, action, handle) !== desired) return true;
    }

    return commentConflictsWithDesiredActionState(item.id, item.comments ?? [], handle);
  };

  const protectCommentTreeFromStaleActionState = (
    itemId: string,
    incomingComments: InquiryComment[],
    currentComments: InquiryComment[],
    handle: string
  ): InquiryComment[] => {
    if (!incomingComments.length) return incomingComments;

    const currentById = new Map(currentComments.flatMap((comment) => (comment.id ? [[comment.id, comment]] : [])));

    let changed = false;
    const nextComments = incomingComments.map((incomingComment) => {
      const currentComment = incomingComment.id ? currentById.get(incomingComment.id) : undefined;
      const incomingReplies = incomingComment.replies ?? [];
      const currentReplies = currentComment?.replies ?? [];
      let nextComment = applyProtectedCommentMetricState(itemId, incomingComment, currentComment, handle);
      if (nextComment !== incomingComment) {
        changed = true;
        nextComment = {
          ...nextComment,
          replies: protectCommentTreeFromStaleActionState(
            itemId,
            incomingReplies,
            currentReplies,
            handle
          )
        };
        return nextComment;
      }

      const nextReplies = protectCommentTreeFromStaleActionState(
        itemId,
        incomingReplies,
        currentReplies,
        handle
      );
      if (nextReplies === incomingReplies) return incomingComment;

      changed = true;
      return { ...incomingComment, replies: nextReplies };
    });

    return changed ? nextComments : incomingComments;
  };

  const protectItemFromStaleActionState = (
    incoming: InquiryItem,
    current: InquiryItem | undefined,
    handle: string
  ) => {
    if (isDeletedPost(incoming)) return incoming;
    if (conflictsWithDesiredActionState(incoming, handle)) return current ?? incoming;

    const metricProtected = applyProtectedPostMetricState(incoming, current, handle);
    const protectedComments = protectCommentTreeFromStaleActionState(
      metricProtected.id,
      metricProtected.comments ?? [],
      current?.comments ?? [],
      handle
    );

    return protectedComments === metricProtected.comments
      ? metricProtected
      : { ...metricProtected, comments: protectedComments };
  };

  const protectItemsFromStaleActionState = (incomingItems: InquiryItem[], handle: string) => {
    const currentById = new Map(itemsRef.current.map((item) => [item.id, item]));
    return incomingItems.map((incoming) => protectItemFromStaleActionState(incoming, currentById.get(incoming.id), handle));
  };

  const mergeLiveEvent = (event: SymposiumLiveEvent) => {
    if (event.cursor) liveEventCursorRef.current = event.cursor;

    const payload = event.payload ?? {};
    if (event.kind === "post.deleted") {
      if (isLiveInquiryItem(payload.item)) {
        const deletedItem = payload.item;
        mergeLiveItem(deletedItem);
        setEditingPost((current) => (current?.id === deletedItem.id ? null : current));
        setEditingComment((current) => (current?.itemId === deletedItem.id ? null : current));
      } else {
        scheduleLiveRefresh();
      }
      return;
    }

    if (event.kind === "comment.deleted" && typeof payload.commentId === "string") {
      setEditingComment((current) => (current?.commentId === payload.commentId ? null : current));
    }

    if (payload.follow || event.kind === "profile.followed" || event.kind === "profile.unfollowed") {
      mergeLiveFollow(payload.follow, event.kind !== "profile.unfollowed");
    }

    if (isLiveInquiryItem(payload.item)) {
      const action = payload.action;
      if (action && event.actorHandle === currentProfileRef.current.handle) {
        if (typeof payload.commentId === "string" && action !== "read") {
          const key = `${payload.item.id}:${payload.commentId}:${action}:${currentProfileRef.current.handle}`;
          const desired = protectedDesiredActionState(key);
          const eventComment = findCommentById(payload.item.comments, payload.commentId);
          const serverActive = eventComment
            ? commentActionActive(eventComment, action, currentProfileRef.current.handle)
            : undefined;
          if (desired !== undefined && serverActive !== desired) return;
          touchProfileCommentAction(payload.item.id, payload.commentId, action, currentProfileRef.current.handle);
        } else {
          const key = `${payload.item.id}:${action}:${currentProfileRef.current.handle}`;
          const desired = protectedDesiredActionState(key);
          const serverActive = itemActionActive(payload.item, action, currentProfileRef.current.handle);
          if (desired !== undefined && serverActive !== desired) return;
          touchProfileAction(payload.item.id, action, currentProfileRef.current.handle);
        }
      }

      mergeLiveItem(payload.item);
      return;
    }

    if (
      event.kind.startsWith("post.") ||
      event.kind.startsWith("comment.") ||
      event.kind.startsWith("profile.") ||
      event.kind.startsWith("community.") ||
      event.kind.startsWith("note.")
    ) {
      scheduleLiveRefresh();
    }
  };

  const fetchLiveEvents = async () => {
    const cursor = liveEventCursorRef.current;
    const response = await fetch(`/api/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {
      cache: "no-store"
    });
    if (!response.ok) return;

    const data = (await response.json()) as { events?: SymposiumLiveEvent[]; cursor?: string | null };
    for (const event of data.events ?? []) mergeLiveEvent(event);
    if (data.cursor) liveEventCursorRef.current = data.cursor;
    markLiveDataConnected();
  };

  useEffect(() => {
    if (entryMode === "loading") return undefined;

    let closed = false;
    let pollTimer: number | null = null;
    let source: EventSource | null = null;

    const startPolling = () => {
      if (pollTimer) return;
      void fetchLiveEvents().catch(() => undefined);
      pollTimer = window.setInterval(() => {
        if (!closed) void fetchLiveEvents().catch(() => undefined);
      }, 2500);
    };

    startPolling();

    if ("EventSource" in window) {
      const cursor = liveEventCursorRef.current;
      source = new EventSource(`/api/events/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      source.onopen = () => {
        if (!closed) markLiveDataConnected();
      };
      source.addEventListener("symposium-ready", () => {
        if (!closed) markLiveDataConnected();
      });
      source.addEventListener("symposium-heartbeat", () => {
        if (!closed) markLiveDataConnected();
      });
      source.addEventListener("symposium-event", (message) => {
        if (closed) return;
        try {
          mergeLiveEvent(JSON.parse((message as MessageEvent<string>).data) as SymposiumLiveEvent);
        } catch {
          scheduleLiveRefresh();
        }
      });
      source.onerror = () => {
        if (!closed) {
          markLiveUpdatesReconnecting();
          startPolling();
        }
      };
    }

    return () => {
      closed = true;
      source?.close();
      if (pollTimer) window.clearInterval(pollTimer);
      if (liveRefreshTimerRef.current) {
        window.clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = null;
      }
    };
  }, [entryMode]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("symposium-theme") as Theme | null;
    const storedNote = window.localStorage.getItem("symposium-notebook");
    const storedProfileHandle = window.localStorage.getItem("symposium-profile-handle");

    if (storedTheme === "day" || storedTheme === "night") {
      setTheme(storedTheme);
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      setTheme("night");
    }
    if (storedNote) setNoteText(storedNote);
    try {
      const storedActivityRecency = JSON.parse(
        window.localStorage.getItem("symposium-activity-recency") ?? "{}"
      ) as Record<string, number>;
      activityRecencyRef.current = storedActivityRecency;
      setActivityRecency(storedActivityRecency);
    } catch {
      activityRecencyRef.current = {};
      setActivityRecency({});
    }
    setEntryMode("approach");

    refreshData(storedProfileHandle ?? undefined).catch(() => {
      const local = readLocalSnapshot();
      const fallbackProfiles = local?.profiles ?? { [profile.handle]: profile };
      const fallbackProfile = fallbackProfiles[storedProfileHandle ?? profile.handle] ?? profile;
      const fallbackItems = sortByPublishedRecency(normalizeClientSeedTimes(local?.items ?? inquiryItems));
      setProfiles(fallbackProfiles);
      setItems(fallbackItems);
      setCurrentProfile(fallbackProfile);
      setSyncStatus("Using seed data");
    });
  }, []);

  useEffect(() => {
    if (!signedIn || !currentProfile.handle) return;

    let cancelled = false;
    const cached = readLocalFollowing(currentProfile.handle);
    setFollowingHandles(cached);
    applySocialLists(currentProfile.handle, {
      following: cached,
      followers: profileSocialLists[currentProfile.handle]?.followers ?? []
    });

    refreshFollowing(currentProfile.handle).catch(() => {
      if (!cancelled) setFollowingHandles(cached);
    });

    return () => {
      cancelled = true;
    };
  }, [currentProfile.handle, signedIn]);

  useEffect(() => {
    if (!selectedProfile?.handle) return;
    void refreshProfileFollows(selectedProfile.handle);
  }, [selectedProfile?.handle]);

  useEffect(() => {
    if (entryMode !== "approach" || !authLoaded || (Boolean(isSignedIn) && !signedIn)) return undefined;

    const timer = window.setTimeout(() => {
      if (signedIn) {
        window.sessionStorage.setItem("symposium-entry-complete", "true");
        setEntryMode("complete");
        setActiveRoom("hall");
      } else {
        setEntryMode("auth");
      }
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [authLoaded, entryMode, isSignedIn, signedIn]);

  useEffect(() => {
    if (!clerkEnabled) return;
    if (!authLoaded) return;

    if (!isSignedIn) {
      setSignedIn(false);
      setSyncedClerkUserId(null);
      window.localStorage.removeItem("symposium-auth-handle");
      window.localStorage.removeItem("symposium-auth-records");
      if (entryMode === "complete") {
        window.sessionStorage.removeItem("symposium-entry-complete");
        setEntryMode("auth");
      }
      return;
    }

    if (!userId || syncedClerkUserId === userId) return;

    let cancelled = false;

    const syncAccount = async () => {
      setSyncStatus("Syncing account");
      setAuthError("");
      const response = await fetch("/api/auth/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        throw new Error("Could not sync your Symposium account.");
      }

      const data = (await response.json()) as { profile: ResearchProfile };
      if (cancelled) return;

      const nextProfiles = { ...profiles, [data.profile.handle]: data.profile };
      setProfiles(nextProfiles);
      setCurrentProfile(data.profile);
      setSignedIn(true);
      setSyncedClerkUserId(userId);
      setEntryMode("complete");
      setActiveRoom("hall");
      setOfficeMode("desk");
      setPatronageMode("lobby");
      setSelectedCommunityId(null);
      setSelectedItemId(null);
      setSelectedCommentId(null);
      setSelectedProfileName(null);
      setViewHistory([]);
      setViewFuture([]);
      window.sessionStorage.setItem("symposium-entry-complete", "true");
      window.localStorage.setItem("symposium-profile-handle", data.profile.handle);
      await refreshData(data.profile.handle);
      setSyncStatus("Signed in");
    };

    syncAccount().catch((error) => {
      if (cancelled) return;
      setAuthError(error instanceof Error ? error.message : "Could not sync your account.");
      setSyncStatus("Account sync failed");
    });

    return () => {
      cancelled = true;
    };
  }, [authLoaded, clerkEnabled, entryMode, isSignedIn, profiles, syncedClerkUserId, userId]);

  useEffect(() => {
    window.localStorage.setItem("symposium-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("symposium-notebook", noteText);
  }, [noteText]);

  const persistActivityRecency = (next: Record<string, number>) => {
    activityRecencyRef.current = next;
    window.localStorage.setItem("symposium-activity-recency", JSON.stringify(next));
  };

  const recordActivityRecency = (updates: Record<string, number>, deferForProfile = false) => {
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => Number.isFinite(value))
    ) as Record<string, number>;
    if (!Object.keys(cleanUpdates).length) return;

    if (deferForProfile) {
      pendingActivityRecencyRef.current = { ...pendingActivityRecencyRef.current, ...cleanUpdates };
      persistActivityRecency({ ...activityRecencyRef.current, ...pendingActivityRecencyRef.current });
      return;
    }

    const pendingUpdates = pendingActivityRecencyRef.current;
    pendingActivityRecencyRef.current = {};
    setActivityRecency((current) => {
      const next = { ...current, ...pendingUpdates, ...cleanUpdates };
      persistActivityRecency(next);
      return next;
    });
  };

  const flushPendingActivityRecency = () => {
    const pendingUpdates = pendingActivityRecencyRef.current;
    if (!Object.keys(pendingUpdates).length) {
      setProfileActivityRevision((revision) => revision + 1);
      return;
    }

    pendingActivityRecencyRef.current = {};
    setActivityRecency((current) => {
      const next = { ...current, ...pendingUpdates };
      persistActivityRecency(next);
      return next;
    });
    setProfileActivityRevision((revision) => revision + 1);
  };

  const touchActivity = (itemId: string, timestamp = Date.now()) => {
    recordActivityRecency({ [itemId]: timestamp });
  };

  const touchProfileAction = (itemId: string, action: PostAction, handle = currentProfile.handle, timestamp = Date.now()) => {
    if (action === "read") return;
    recordActivityRecency(
      { [profileActivityKey(handle, action, itemId)]: timestamp },
      Boolean(selectedProfileNameRef.current)
    );
  };

  const touchProfileCommentAction = (
    itemId: string,
    commentId: string,
    action: CommentAction,
    handle = currentProfile.handle,
    timestamp = Date.now()
  ) => {
    if (action === "read") return;
    recordActivityRecency(
      { [profileCommentActivityKey(handle, action, itemId, commentId)]: timestamp },
      Boolean(selectedProfileNameRef.current)
    );
  };

  const updateCommentSegmentStack = (key: string, stack: string[]) => {
    setCommentSegmentStacks((current) => {
      const currentStack = current[key] ?? [];
      if (currentStack.join("|") === stack.join("|")) return current;

      const next = { ...current };
      if (stack.length) {
        next[key] = [...stack];
      } else {
        delete next[key];
      }
      commentSegmentStacksRef.current = next;
      return next;
    });
  };

  const registerVisibleCommentSegmentStack = (key: string, stack: string[]) => {
    const next = { ...visibleCommentSegmentStacksRef.current };
    next[key] = [...stack];
    visibleCommentSegmentStacksRef.current = next;
  };

  const visibleCommentSegmentStacksFromDom = () => {
    const stacks: CommentSegmentStacks = {};
    document.querySelectorAll<HTMLElement>(".comment-segment[data-comment-segment-key]").forEach((segment) => {
      const key = segment.dataset.commentSegmentKey;
      if (!key) return;
      stacks[key] = parseCommentSegmentStack(segment.dataset.commentSegmentStack);
    });
    return stacks;
  };

  const currentScrollAnchor = () => {
    const targetTop = 132;
    const comments = Array.from(document.querySelectorAll<HTMLElement>(".comment[id]"));
    const visibleComments = comments
      .map((comment) => ({ comment, rect: comment.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > 0 && rect.top < window.innerHeight);
    const anchor =
      visibleComments.find(({ rect }) => rect.top <= targetTop && rect.bottom >= targetTop) ??
      visibleComments.sort(
        (first, second) => Math.abs(first.rect.top - targetTop) - Math.abs(second.rect.top - targetTop)
      )[0];
    if (!anchor) return null;
    const segment = anchor.comment.closest<HTMLElement>(".comment-segment[data-comment-segment-key]");
    return {
      id: anchor.comment.id,
      top: anchor.rect.top,
      commentSegmentKey: segment?.dataset.commentSegmentKey,
      commentSegmentStack: parseCommentSegmentStack(segment?.dataset.commentSegmentStack)
    };
  };

  const snapshotView = (): ViewSnapshot => {
    const scrollAnchor = currentScrollAnchor();
    const domSegmentStacks = visibleCommentSegmentStacksFromDom();
    if (scrollAnchor?.commentSegmentKey) {
      domSegmentStacks[scrollAnchor.commentSegmentKey] = [...(scrollAnchor.commentSegmentStack ?? [])];
    }

    return {
      activeRoom,
      selectedItemId,
      selectedCommentId: null,
      selectedProfileName,
      officeMode,
      patronageMode,
      selectedCommunityId,
      commentSegmentStacks: cloneCommentSegmentStacks({
        ...commentSegmentStacksRef.current,
        ...visibleCommentSegmentStacksRef.current,
        ...domSegmentStacks
      }),
      scrollAnchor,
      scrollY: window.scrollY
    };
  };

  const restoreScrollPosition = (snapshot: ViewSnapshot) => {
    const scroll = () => {
      if (snapshot.scrollAnchor) {
        const anchor = document.getElementById(snapshot.scrollAnchor.id);
        if (anchor) {
          const top = anchor.getBoundingClientRect().top;
          window.scrollBy({ top: top - snapshot.scrollAnchor.top, behavior: "auto" });
          return;
        }
      }
      window.scrollTo({ top: snapshot.scrollY, behavior: "auto" });
    };
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(scroll);
      });
    }, 0);
    window.setTimeout(scroll, 120);
    window.setTimeout(scroll, 320);
  };

  const restoreView = (snapshot: ViewSnapshot) => {
    if (snapshot.selectedProfileName) flushPendingActivityRecency();
    setActiveRoom(snapshot.activeRoom);
    setSelectedItemId(snapshot.selectedItemId);
    setSelectedCommentId(snapshot.selectedCommentId);
    setSelectedProfileName(snapshot.selectedProfileName);
    setOfficeMode(snapshot.officeMode);
    setPatronageMode(snapshot.patronageMode);
    setSelectedCommunityId(snapshot.selectedCommunityId);
    const restoredSegmentStacks = cloneCommentSegmentStacks(snapshot.commentSegmentStacks ?? {});
    commentSegmentStacksRef.current = restoredSegmentStacks;
    visibleCommentSegmentStacksRef.current = {};
    setCommentSegmentStacks(restoredSegmentStacks);
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesOpen(false);
    restoreScrollPosition(snapshot);
  };

  const navigateView = (
    next: Partial<Omit<ViewSnapshot, "scrollY">>,
    scrollY: number | null = 0
  ) => {
    if (next.selectedProfileName) flushPendingActivityRecency();
    setViewHistory((history) => [...history, snapshotView()]);
    setViewFuture([]);
    if (next.activeRoom !== undefined) setActiveRoom(next.activeRoom);
    if (next.selectedItemId !== undefined) setSelectedItemId(next.selectedItemId);
    if (next.selectedCommentId !== undefined) setSelectedCommentId(next.selectedCommentId);
    if (next.selectedProfileName !== undefined) setSelectedProfileName(next.selectedProfileName);
    if (next.selectedItemId !== undefined && next.selectedItemId !== selectedItemId) {
      commentSegmentStacksRef.current = {};
      visibleCommentSegmentStacksRef.current = {};
      setCommentSegmentStacks({});
    }
    if (next.officeMode !== undefined) setOfficeMode(next.officeMode);
    if (next.patronageMode !== undefined) setPatronageMode(next.patronageMode);
    if (next.selectedCommunityId !== undefined) setSelectedCommunityId(next.selectedCommunityId);
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesOpen(false);
    if (scrollY !== null) {
      window.setTimeout(() => window.scrollTo({ top: scrollY, behavior: "auto" }), 0);
    }
  };

  const goBack = () => {
    setViewHistory((history) => {
      if (!history.length) return history;
      const previous = history[history.length - 1];
      setViewFuture((future) => [snapshotView(), ...future]);
      restoreView(previous);
      return history.slice(0, -1);
    });
  };

  const goForward = () => {
    setViewFuture((future) => {
      if (!future.length) return future;
      const next = future[0];
      setViewHistory((history) => [...history, snapshotView()]);
      restoreView(next);
      return future.slice(1);
    });
  };

  const enterRoom = (roomId: RoomId, mode: OfficeMode = roomId === "office" ? "desk" : officeMode) => {
    navigateView({
      activeRoom: roomId,
      selectedItemId: null,
      selectedCommentId: null,
      selectedProfileName: null,
      officeMode: roomId === "office" ? mode : "desk",
      patronageMode: roomId === "funding" ? "lobby" : patronageMode,
      selectedCommunityId: null
    });
  };

  const toggleOfficeMode = (mode: Exclude<OfficeMode, "desk">) => {
    enterRoom("office", activeRoom === "office" && officeMode === mode ? "desk" : mode);
  };

  const openPatronageMode = (mode: PatronageMode) => {
    navigateView({
      activeRoom: "funding",
      selectedItemId: null,
      selectedCommentId: null,
      selectedProfileName: null,
      officeMode: "desk",
      patronageMode: mode,
      selectedCommunityId: null
    });
  };

  const openCommunity = (communityId: string) => {
    navigateView({
      activeRoom: "communities",
      selectedItemId: null,
      selectedCommentId: null,
      selectedProfileName: null,
      officeMode: "desk",
      patronageMode: "lobby",
      selectedCommunityId: communityId
    });
  };

  const closeCommunity = () => {
    navigateView({
      activeRoom: "communities",
      selectedItemId: null,
      selectedCommentId: null,
      selectedProfileName: null,
      officeMode: "desk",
      patronageMode: "lobby",
      selectedCommunityId: null
    });
  };

  const openProfile = (profileKey: string) => {
    flushPendingActivityRecency();
    navigateView({ selectedProfileName: profileKey, selectedItemId: null, selectedCommentId: null });
  };

  const changeProfileTab = (handle: string, tab: ProfileTab) => {
    flushPendingActivityRecency();
    setProfileActiveTabs((current) => ({ ...current, [handle]: tab }));
  };

  const openNotebook = () => {
    setTabletOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesOpen(false);
    setNotebookOpen(true);
  };

  const openTablet = () => {
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setSearchOpen(false);
    setMessagesOpen(false);
    setTabletOpen(true);
  };

  const openSearch = () => {
    setTabletOpen(false);
    setNotebookOpen(false);
    setComposerOpen(false);
    setSettingsOpen(false);
    setMessagesOpen(false);
    setSearchOpen(true);
  };

  const openAttachmentPreview: AttachmentPreviewHandler = (item, attachmentId) => {
    setAttachmentPreview({ itemId: item.id, attachmentId });
  };

  const routePostRoom = (kind: PostDraft["kind"]): Exclude<RoomId, "hall" | "office"> =>
    kind === "paper" ? "library" : "amphitheater";

  const uploadPostAttachment = async (file: File): Promise<InquiryAttachment> => {
    const contentType = inferAttachmentContentType(file.name, file.type);
    const validationError = validatePostAttachmentDetails(file.name, contentType, file.size);
    if (validationError) throw new Error(validationError);

    const metadata = await buildPostAttachmentMetadata(file, contentType);
    const uploadResponse = await fetch("/api/attachments/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorHandle: currentProfile.handle,
        fileName: file.name,
        contentType,
        byteSize: file.size,
        ownerType: "post"
      })
    });

    if (!uploadResponse.ok) {
      const error = (await uploadResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error ?? "Could not prepare this attachment upload.");
    }

    const upload = (await uploadResponse.json()) as AttachmentUploadResponse;
    if (!upload.uploadUrl || !upload.attachmentId || !upload.publicUrl) {
      throw new Error("Could not prepare this attachment upload.");
    }

    const putResponse = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file
    });
    if (!putResponse.ok) {
      throw new Error("Could not upload this attachment.");
    }

    const confirmResponse = await fetch("/api/attachments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorHandle: currentProfile.handle,
        attachmentId: upload.attachmentId,
        byteSize: file.size,
        metadata
      })
    });
    if (!confirmResponse.ok) {
      const error = (await confirmResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error ?? "Could not confirm this attachment.");
    }

    return {
      id: upload.attachmentId,
      fileName: file.name,
      contentType,
      byteSize: file.size,
      url: upload.publicUrl,
      status: "uploaded",
      kind: attachmentKindForContentType(contentType),
      metadata,
      createdAt: new Date().toISOString()
    };
  };

  const createPost = async ({ title, body, kind, attachments }: PostDraft) => {
    const routedRoom = routePostRoom(kind);
    const createdAt = new Date().toISOString();
    setSyncStatus("Posting");
    let response: Response;
    try {
      response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, kind, room: routedRoom, authorHandle: currentProfile.handle, attachments })
      });
    } catch {
      setSyncStatus("Post could not reach the live service");
      return false;
    }

    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null;
      setSyncStatus(error?.error ?? "Post could not be saved");
      return false;
    }

    const data = (await response.json()) as { item: InquiryItem };
    const committedItem = { ...data.item, createdAt: data.item.createdAt ?? createdAt };
    const nextItems = sortByPublishedRecency([committedItem, ...items.filter((item) => item.id !== committedItem.id)]);
    touchActivity(committedItem.id);
    setItems(nextItems);
    persistLocalSnapshot(nextItems, profiles);
    navigateView({
      activeRoom: committedItem.room,
      selectedItemId: committedItem.id,
      selectedCommentId: null,
      selectedProfileName: null,
      officeMode: "desk"
    });
    setComposerOpen(false);
    setSyncStatus("Post saved");
    return true;
  };

  const addComment = async (itemId: string, body: string, stance: string, parentId?: string | null) => {
    const previousItems = itemsRef.current;
    const previousSelectedItemId = selectedItemId;
    const previousSelectedCommentId = selectedCommentId;
    const existing = previousItems.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing)) {
      setSyncStatus("This post cannot accept comments");
      return;
    }

    if (parentId && !findCommentById(existing.comments, parentId)) {
      setSyncStatus("Reply target is no longer available");
      return;
    }

    setSyncStatus(parentId ? "Saving reply" : "Saving comment");

    const optimisticComment: InquiryComment = {
      id: clientId("comment"),
      parentId: parentId ?? null,
      author: currentProfile.name,
      authorHandle: currentProfile.handle,
      stance: stance.trim() || "Comment",
      body,
      createdAt: new Date().toISOString(),
      metrics: { ...commentMetricsFallback },
      savedBy: [],
      signaledBy: [],
      forkedBy: [],
      replies: []
    };
    const appended = appendCommentToTree(existing.comments, optimisticComment);
    if (!appended.inserted) {
      setSyncStatus("Reply target is no longer available");
      return;
    }

    const nextCritiques = incrementMetric(existing.metrics.critiques, 1);
    const optimisticItem: InquiryItem = {
      ...existing,
      metrics: { ...existing.metrics, critiques: nextCritiques },
      signals: updateSignalValue(existing.signals, "Critiques", nextCritiques),
      comments: appended.comments
    };
    const optimisticItems = previousItems.map((item) => (item.id === itemId ? optimisticItem : item));

    itemsRef.current = optimisticItems;
    setItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    touchActivity(itemId);
    setSelectedItemId(itemId);
    setSelectedCommentId(optimisticComment.id ?? null);

    try {
      const response = await fetch(`/api/posts/${itemId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, stance, parentId: parentId ?? null, authorHandle: currentProfile.handle })
      });
      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        itemsRef.current = previousItems;
        setItems(previousItems);
        persistLocalSnapshot(previousItems, profilesRef.current);
        setSelectedItemId(previousSelectedItemId);
        setSelectedCommentId(previousSelectedCommentId);
        setSyncStatus(errorData.error ?? (parentId ? "Reply could not be saved" : "Comment could not be saved"));
        return;
      }

      const data = (await response.json().catch(() => ({}))) as { comment?: InquiryComment; item?: InquiryItem };
      if (data.item) {
        const currentItem = itemsRef.current.find((item) => item.id === itemId);
        const committedItem = preservePublishedPosition(
          protectItemFromStaleActionState(data.item, currentItem, currentProfile.handle),
          currentItem
        );
        const committedItems = itemsRef.current.map((item) => (item.id === itemId ? committedItem : item));
        itemsRef.current = committedItems;
        setItems(committedItems);
        persistLocalSnapshot(committedItems, profilesRef.current);
      }

      setSelectedCommentId(data.comment?.id ?? optimisticComment.id ?? null);
      setSyncStatus(parentId ? "Reply saved" : "Comment saved");
    } catch {
      setSyncStatus(parentId ? "Reply saved locally" : "Comment saved locally");
    }
  };

  const enterLocalPreview = () => {
    const fallbackProfiles = Object.keys(profiles).length ? profiles : { [profile.handle]: profile };
    const previewProfile =
      fallbackProfiles[currentProfile.handle] ?? fallbackProfiles[profile.handle] ?? currentProfile ?? profile;

    setProfiles(fallbackProfiles);
    setCurrentProfile(previewProfile);
    setSignedIn(true);
    setAuthError("");
    setEntryMode("complete");
    setActiveRoom("hall");
    setOfficeMode("desk");
    setPatronageMode("lobby");
    setSelectedCommunityId(null);
    setSelectedItemId(null);
    setSelectedCommentId(null);
    setSelectedProfileName(null);
    setViewHistory([]);
    setViewFuture([]);
    window.sessionStorage.setItem("symposium-entry-complete", "true");
    window.localStorage.setItem("symposium-profile-handle", previewProfile.handle);
    persistLocalSnapshot(items, fallbackProfiles, previewProfile);
    setSyncStatus("Local preview");
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
      reader.addEventListener("error", () => reject(new Error("Could not read this image.")));
      reader.readAsDataURL(file);
    });

  const uploadProfileAvatar = async (file: File) => {
    const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);

    if (!allowedImageTypes.has(file.type)) {
      throw new Error("Choose a PNG, JPG, JPEG, WEBP, GIF, or AVIF image.");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Profile photos must be 5 MB or smaller.");
    }

    setSyncStatus("Preparing profile photo");
    const uploadResponse = await fetch("/api/attachments/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorHandle: currentProfile.handle,
        fileName: file.name,
        contentType: file.type,
        byteSize: file.size,
        ownerType: "profile",
        ownerId: currentProfile.handle
      })
    });

    if (!uploadResponse.ok) {
      const error = (await uploadResponse.json().catch(() => null)) as { error?: string } | null;
      if (uploadResponse.status === 412 && error?.error?.includes("local preview")) {
        setSyncStatus("Profile photo previewed locally");
        return readFileAsDataUrl(file);
      }
      throw new Error(error?.error ?? "Could not prepare this profile photo.");
    }

    const upload = (await uploadResponse.json()) as AttachmentUploadResponse;

    if (!upload.uploadUrl || !upload.attachmentId) {
      throw new Error("Could not prepare this profile photo upload.");
    }

    if (!upload.publicUrl) {
      throw new Error("Profile photo storage needs a public R2 URL before photos can persist.");
    }

    setSyncStatus("Uploading profile photo");
    const putResponse = await fetch(upload.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file
    });

    if (!putResponse.ok) {
      throw new Error("Could not upload the profile photo.");
    }

    const confirmResponse = await fetch("/api/attachments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actorHandle: currentProfile.handle,
        attachmentId: upload.attachmentId,
        byteSize: file.size
      })
    });

    if (!confirmResponse.ok) {
      throw new Error("Could not confirm the profile photo upload.");
    }

    setSyncStatus("Profile photo ready");
    return upload.publicUrl;
  };

  const saveProfileSettings = async (draft: ProfileSettingsDraft) => {
    const cleanName = draft.name.trim() || currentProfile.name;
    const updatedProfile: ResearchProfile = {
      ...currentProfile,
      name: cleanName,
      avatarUrl: draft.avatarUrl?.trim() || undefined,
      bio: (draft.bio.trim() || currentProfile.bio).slice(0, 200),
      likesPublic: draft.likesPublic,
      resharesPublic: draft.resharesPublic
    };
    const nextProfiles = { ...profiles, [updatedProfile.handle]: updatedProfile };
    const nextItems = items.map((item) => ({
      ...item,
      author: item.authorHandle === updatedProfile.handle ? updatedProfile.name : item.author,
      comments: updateCommentsForProfile(item.comments, updatedProfile)
    }));

    setCurrentProfile(updatedProfile);
    setProfiles(nextProfiles);
    setItems(nextItems);
    if (selectedProfileName === currentProfile.name || selectedProfileName === currentProfile.handle) {
      setSelectedProfileName(updatedProfile.handle);
    }
    persistLocalSnapshot(nextItems, nextProfiles, updatedProfile);
    setSettingsOpen(false);
    setSyncStatus("Saving profile settings");

    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: updatedProfile.name,
        handle: updatedProfile.handle,
        email: updatedProfile.email,
        avatarUrl: updatedProfile.avatarUrl,
        likesPublic: updatedProfile.likesPublic,
        resharesPublic: updatedProfile.resharesPublic,
        role: updatedProfile.role,
        location: updatedProfile.location,
        bio: updatedProfile.bio,
        fields: updatedProfile.fields
      })
    });

    if (response.ok) {
      const data = (await response.json()) as { profile: ResearchProfile };
      const committedProfile = { ...updatedProfile, ...data.profile };
      const committedProfiles = { ...nextProfiles, [committedProfile.handle]: committedProfile };
      const committedItems = nextItems.map((item) => ({
        ...item,
        author: item.authorHandle === committedProfile.handle ? committedProfile.name : item.author,
        comments: updateCommentsForProfile(item.comments, committedProfile)
      }));
      setCurrentProfile(committedProfile);
      setProfiles(committedProfiles);
      setItems(committedItems);
      persistLocalSnapshot(committedItems, committedProfiles, committedProfile);
      setSyncStatus("Profile settings saved");
    } else {
      setSyncStatus("Profile saved locally");
    }
  };

  const toggleFollow = async (targetHandle: string) => {
    const normalizedTarget = cleanHandle(targetHandle);
    if (!normalizedTarget || normalizedTarget === currentProfile.handle) return;

    const wasFollowing = followingHandles.includes(normalizedTarget);
    const previousHandles = followingHandles;
    const nextHandles = wasFollowing
      ? previousHandles.filter((handle) => handle !== normalizedTarget)
      : Array.from(new Set([...previousHandles, normalizedTarget]));
    const currentSocial = profileSocialLists[currentProfile.handle] ?? { following: previousHandles, followers: [] };
    const targetSocial = profileSocialLists[normalizedTarget] ?? { following: [], followers: [] };
    const nextTargetFollowers = wasFollowing
      ? targetSocial.followers.filter((handle) => handle !== currentProfile.handle)
      : Array.from(new Set([...targetSocial.followers, currentProfile.handle]));

    setFollowingHandles(nextHandles);
    applySocialLists(currentProfile.handle, { ...currentSocial, following: nextHandles });
    applySocialLists(normalizedTarget, { ...targetSocial, followers: nextTargetFollowers });
    persistLocalFollowing(currentProfile.handle, nextHandles);
    setSyncStatus(wasFollowing ? "Unfollowing profile" : "Following profile");

    try {
      const response = await fetch(`/api/profiles/${encodeURIComponent(normalizedTarget)}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Follow action failed.");
      setSyncStatus(wasFollowing ? "Profile unfollowed" : "Following profile");
    } catch {
      setFollowingHandles(previousHandles);
      applySocialLists(currentProfile.handle, { ...currentSocial, following: previousHandles });
      applySocialLists(normalizedTarget, { ...targetSocial });
      persistLocalFollowing(currentProfile.handle, previousHandles);
      setSyncStatus("Follow could not sync");
    }
  };

  const signOut = async () => {
    await auth.signOut().catch(() => undefined);
    window.localStorage.removeItem("symposium-auth-handle");
    window.localStorage.removeItem("symposium-auth-records");
    window.sessionStorage.removeItem("symposium-entry-complete");
    setSignedIn(false);
    setSyncedClerkUserId(null);
    setSettingsOpen(false);
    setAuthError("");
    setEntryMode("auth");
  };

  const applyAction = async (itemId: string, action: PostAction, options: ViewActionOptions = {}) => {
    const isViewAction = action === "read";
    if (isViewAction && !claimClientView("post", itemId)) return;

    const actorHandle = currentProfile.handle;
    const actionKey = `${itemId}:${action}:${actorHandle}`;
    const version = (actionVersionsRef.current[actionKey] ?? 0) + 1;
    actionVersionsRef.current[actionKey] = version;

    const previousItems = itemsRef.current;
    let actionApplied = false;
    let desiredActive: boolean | undefined;
    let protectedMetricState: ProtectedActionMetricState | undefined;
    const optimisticItems = previousItems.map((item) => {
      if (item.id !== itemId) return item;
      if (isDeletedPost(item)) return item;
      actionApplied = true;
      const nextItem = mutateItemForActor(item, action, actorHandle, profile.handle);
      protectedMetricState = actionMetricStateFromValues(item.metrics, nextItem.metrics, action);
      if (action === "save") desiredActive = isSavedBy(nextItem, actorHandle, profile.handle);
      if (action === "signal") desiredActive = hasHandle(nextItem.signaledBy, actorHandle);
      if (action === "fork") desiredActive = hasHandle(nextItem.forkedBy, actorHandle);
      return nextItem;
    });

    if (!actionApplied) {
      if (isViewAction) releaseClientViewClaim("post", itemId);
      return;
    }
    setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);

    itemsRef.current = optimisticItems;
    setItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    touchProfileAction(itemId, action);

    try {
      const response = await fetch(`/api/posts/${itemId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actorHandle, active: desiredActive, trigger: options.trigger, surface: options.surface })
      });

      if (!response.ok) throw new Error("Post action failed.");

      const data = (await response.json()) as { item: InquiryItem };
      if (actionVersionsRef.current[actionKey] !== version) {
        const latestActive = protectedDesiredActionState(actionKey);
        if (latestActive !== undefined) {
          void fetch(`/api/posts/${itemId}/actions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, actorHandle, active: latestActive, trigger: options.trigger, surface: options.surface })
          }).catch(() => undefined);
        }
        return;
      }

      const committedActive = itemActionActive(data.item, action, actorHandle);
      if (desiredActive !== undefined && committedActive !== desiredActive) {
        setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
        setSyncStatus("Action syncing");
        return;
      }

      const committedItems = itemsRef.current.map((item) =>
        item.id === itemId
          ? preservePublishedPosition(protectItemFromStaleActionState(data.item, item, actorHandle), item)
          : item
      );
      itemsRef.current = committedItems;
      setItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
      setSyncStatus("Action synced");
    } catch {
      if (actionVersionsRef.current[actionKey] !== version) return;
      clearDesiredActionState(actionKey);
      if (isViewAction) releaseClientViewClaim("post", itemId);
      itemsRef.current = previousItems;
      setItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Action could not sync");
    }
  };

  const applyCommentAction = async (
    itemId: string,
    commentId: string,
    action: CommentAction,
    options: ViewActionOptions = {}
  ) => {
    const isViewAction = action === "read";
    if (isViewAction && !claimClientView("comment", commentId)) return;

    const actorHandle = currentProfile.handle;
    const actionKey = `${itemId}:${commentId}:${action}:${actorHandle}`;
    const version = (actionVersionsRef.current[actionKey] ?? 0) + 1;
    actionVersionsRef.current[actionKey] = version;

    const previousItems = itemsRef.current;
    let actionApplied = false;
    let desiredActive: boolean | undefined;
    let protectedMetricState: ProtectedActionMetricState | undefined;
    const optimisticItems = previousItems.map((item) => {
      if (item.id !== itemId) return item;
      const mapped = mapCommentTree(item.comments, commentId, (comment) => {
        const nextComment = mutateCommentForActor(comment, action, actorHandle);
        protectedMetricState = actionMetricStateFromValues(
          { ...commentMetricsFallback, ...(comment.metrics ?? {}) },
          { ...commentMetricsFallback, ...(nextComment.metrics ?? {}) },
          action
        );
        return nextComment;
      });
      if (!mapped.updated) return item;
      actionApplied = true;
      desiredActive = commentActionActive(mapped.updated, action, actorHandle);
      return { ...item, comments: mapped.comments };
    });

    if (!actionApplied) {
      if (isViewAction) releaseClientViewClaim("comment", commentId);
      return;
    }
    setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
    itemsRef.current = optimisticItems;
    setItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    touchProfileCommentAction(itemId, commentId, action);

    try {
      const response = await fetch(`/api/posts/${itemId}/comments/${commentId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actorHandle, active: desiredActive, trigger: options.trigger, surface: options.surface })
      });

      if (!response.ok) throw new Error("Comment action failed.");

      const data = (await response.json()) as { item: InquiryItem };
      if (actionVersionsRef.current[actionKey] !== version) return;

      const committedComment = findCommentById(data.item.comments, commentId);
      const committedActive = committedComment
        ? commentActionActive(committedComment, action, actorHandle)
        : undefined;
      if (desiredActive !== undefined && committedActive !== desiredActive) {
        setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
        setSyncStatus("Comment action syncing");
        return;
      }

      const committedItems = itemsRef.current.map((item) =>
        item.id === itemId
          ? preservePublishedPosition(protectItemFromStaleActionState(data.item, item, actorHandle), item)
          : item
      );
      itemsRef.current = committedItems;
      setItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setProtectedDesiredActionState(actionKey, desiredActive, protectedMetricState);
      setSyncStatus("Comment action synced");
    } catch {
      if (actionVersionsRef.current[actionKey] !== version) return;
      clearDesiredActionState(actionKey);
      if (isViewAction) releaseClientViewClaim("comment", commentId);
      itemsRef.current = previousItems;
      setItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Comment action could not sync");
    }
  };

  const savePostEdit = async (itemId: string, draft: { title: string; body: string }) => {
    const cleanTitle = draft.title.trim();
    const cleanBody = draft.body.trim();
    if (!cleanTitle || !cleanBody) return;

    const previousItems = itemsRef.current;
    const existing = previousItems.find((item) => item.id === itemId);
    if (!existing || isDeletedPost(existing)) return;
    const editedAt = new Date().toISOString();
    const optimisticItems = previousItems.map((item) =>
      item.id === itemId
        ? { ...item, title: cleanTitle, body: cleanBody, excerpt: cleanBody, claims: [cleanBody], editedAt }
        : item
    );

    itemsRef.current = optimisticItems;
    setItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    setEditingPost(null);
    setSyncStatus("Saving post edit");

    try {
      const response = await fetch(`/api/posts/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: cleanTitle, body: cleanBody, actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Post edit failed.");

      const data = (await response.json()) as { item: InquiryItem };
      const committedItems = itemsRef.current.map((item) =>
        item.id === itemId ? preservePublishedPosition(data.item, item) : item
      );
      itemsRef.current = committedItems;
      setItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setSyncStatus("Post edited");
    } catch {
      itemsRef.current = previousItems;
      setItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Post edit could not sync");
    }
  };

  const deletePost = async (itemId: string) => {
    const item = itemsRef.current.find((current) => current.id === itemId);
    if (!item || isDeletedPost(item) || cleanHandle(item.authorHandle ?? item.author) !== currentProfile.handle) return;
    if (!window.confirm(`Delete "${item.title}"?`)) return;

    const previousItems = itemsRef.current;
    const deleted = tombstonePost(item);
    const nextItems = previousItems.map((current) => (current.id === itemId ? deleted : current));
    itemsRef.current = nextItems;
    setItems(nextItems);
    persistLocalSnapshot(nextItems, profilesRef.current);
    setEditingPost(null);
    setSyncStatus("Deleting post");

    try {
      const response = await fetch(`/api/posts/${itemId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Post delete failed.");
      const data = (await response.json()) as { item?: InquiryItem };
      if (data.item) {
        const committedItems = itemsRef.current.map((current) =>
          current.id === itemId ? preservePublishedPosition(data.item!, current) : current
        );
        itemsRef.current = committedItems;
        setItems(committedItems);
        persistLocalSnapshot(committedItems, profilesRef.current);
      }
      setSyncStatus("Post deleted");
    } catch {
      itemsRef.current = previousItems;
      setItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Post delete could not sync");
    }
  };

  const saveCommentEdit = async (itemId: string, commentId: string, body: string) => {
    const cleanBody = body.trim();
    if (!cleanBody) return;

    const previousItems = itemsRef.current;
    const existing = previousItems.find((item) => item.id === itemId);
    const existingComment = existing ? findCommentById(existing.comments, commentId) : undefined;
    if (
      !existing ||
      !existingComment ||
      isDeletedComment(existingComment) ||
      cleanHandle(existingComment.authorHandle ?? existingComment.author) !== currentProfile.handle
    ) {
      return;
    }

    const editedAt = new Date().toISOString();
    const optimisticItems = previousItems.map((item) => {
      if (item.id !== itemId) return item;
      const mapped = mapCommentTree(item.comments, commentId, (comment) => ({
        ...comment,
        body: cleanBody,
        editedAt
      }));
      return mapped.updated ? { ...item, comments: mapped.comments } : item;
    });

    itemsRef.current = optimisticItems;
    setItems(optimisticItems);
    persistLocalSnapshot(optimisticItems, profilesRef.current);
    setEditingComment(null);
    setSyncStatus("Saving comment edit");

    try {
      const response = await fetch(`/api/posts/${itemId}/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: cleanBody, actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Comment edit failed.");

      const data = (await response.json()) as { item: InquiryItem };
      const committedItems = itemsRef.current.map((item) =>
        item.id === itemId ? preservePublishedPosition(data.item, item) : item
      );
      itemsRef.current = committedItems;
      setItems(committedItems);
      persistLocalSnapshot(committedItems, profilesRef.current);
      setSyncStatus("Comment edited");
    } catch {
      itemsRef.current = previousItems;
      setItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Comment edit could not sync");
    }
  };

  const deleteComment = async (itemId: string, commentId: string) => {
    const item = itemsRef.current.find((current) => current.id === itemId);
    const comment = item ? findCommentById(item.comments, commentId) : undefined;
    if (
      !item ||
      !comment ||
      isDeletedComment(comment) ||
      cleanHandle(comment.authorHandle ?? comment.author) !== currentProfile.handle
    ) {
      return;
    }
    if (!window.confirm("Delete this comment?")) return;

    const previousItems = itemsRef.current;
    const nextItems = previousItems.map((current) => {
      if (current.id !== itemId) return current;
      const mapped = mapCommentTree(current.comments, commentId, tombstoneComment);
      return mapped.updated ? { ...current, comments: mapped.comments } : current;
    });
    itemsRef.current = nextItems;
    setItems(nextItems);
    persistLocalSnapshot(nextItems, profilesRef.current);
    setEditingComment((current) =>
      current?.itemId === itemId && current.commentId === commentId ? null : current
    );
    setSyncStatus("Deleting comment");

    try {
      const response = await fetch(`/api/posts/${itemId}/comments/${commentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actorHandle: currentProfile.handle })
      });

      if (!response.ok) throw new Error("Comment delete failed.");
      const data = (await response.json()) as { item?: InquiryItem };
      if (data.item) {
        const committedItems = itemsRef.current.map((current) =>
          current.id === itemId ? preservePublishedPosition(data.item!, current) : current
        );
        itemsRef.current = committedItems;
        setItems(committedItems);
        persistLocalSnapshot(committedItems, profilesRef.current);
      }
      setSyncStatus("Comment deleted");
    } catch {
      itemsRef.current = previousItems;
      setItems(previousItems);
      persistLocalSnapshot(previousItems, profilesRef.current);
      setSyncStatus("Comment delete could not sync");
    }
  };

  const openPost = (id: string, commentId?: string | null, sourceSurface?: ViewSurface) => {
    navigateView(
      { selectedItemId: id, selectedCommentId: commentId ?? null, selectedProfileName: null },
      commentId ? null : 0
    );
    const targetItem = itemsRef.current.find((item) => item.id === id);
    if (targetItem && !isDeletedPost(targetItem)) {
      void applyAction(id, "read", {
        trigger: "click",
        surface: sourceSurface ?? (selectedProfileNameRef.current ? "profile" : "feed")
      });
    }
  };

  const currentContext = selectedItem
    ? `${selectedItem.title}: ${selectedItem.gatheringReason}`
    : `${activeRoomData.name}: ${activeRoomData.description}`;

  const searchResults = useMemo(() => {
    const term = normalizeSearchPhrase(searchQuery);
    if (!term) return { titleMatches: [] as InquiryItem[], contentMatches: [] as InquiryItem[], profileMatches: [] as ResearchProfile[] };

    const titleMatches = sortByPublishedRecency(
      activeItems.filter((item) => normalizeSearchPhrase(item.title).includes(term))
    );
    const titleIds = new Set(titleMatches.map((item) => item.id));
    const contentMatches = sortByPublishedRecency(
      activeItems.filter((item) => !titleIds.has(item.id) && normalizeSearchPhrase(searchableContentText(item)).includes(term))
    );
    const profileMatches = profileList
      .filter((person) =>
        [person.name, person.handle, person.role, person.location, person.bio, ...person.fields]
          .join(" ")
          .toLowerCase()
          .includes(term)
      )
      .slice(0, 8);

    return { titleMatches, contentMatches, profileMatches };
  }, [activeItems, profileList, searchQuery]);

  if (entryMode !== "complete") {
    return (
      <EntrySequence
        theme={theme}
        entranceRender={entranceRenders[theme]}
        mode={entryMode}
        authError={authError}
        authLoaded={authLoaded}
        clerkEnabled={clerkEnabled}
        onLocalPreview={enterLocalPreview}
        preloadRenders={themePreloadRenders}
      />
    );
  }

  return (
    <main
      className={`symposium-shell ${theme}`}
      data-room={activeRoom}
      data-patronage-mode={activeRoom === "funding" ? patronageMode : undefined}
      data-community-selected={selectedCommunity ? "true" : undefined}
      data-view={selectedProfile ? "profile" : selectedItem ? "detail" : activeRoom === "hall" ? "hall" : "room"}
      style={{ "--room-bg": `url(${activeRoomRender})` } as CSSProperties}
    >
      <div className="ambient-layer" aria-hidden="true" />
      <RenderPreloadDeck sources={themePreloadRenders} />

      <header className="topbar">
        <button className="brand" type="button" onClick={() => enterRoom("hall")}>
          {activeRoom !== "hall" && <ArrowLeft size={18} />}
          <span>
            <strong>{activeRoom === "hall" ? "SYMPOSIUM" : "Exit"}</strong>
            {activeRoom !== "hall" && <small>Main hall</small>}
          </span>
        </button>

        <ViewNav
          canGoBack={viewHistory.length > 0}
          canGoForward={viewFuture.length > 0}
          onBack={goBack}
          onForward={goForward}
          onHome={() => enterRoom("hall")}
        />

        <nav className="topbar-actions" aria-label="Primary controls">
          <button
            className="icon-button"
            type="button"
            title={theme === "day" ? "Enter night mode" : "Enter day mode"}
            onClick={() => setTheme((value) => (value === "day" ? "night" : "day"))}
          >
            {theme === "day" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button
            className="icon-button"
            type="button"
            title="Messages"
            onClick={() => {
              setNotebookOpen(false);
              setTabletOpen(false);
              setComposerOpen(false);
              setSettingsOpen(false);
              setSearchOpen(false);
              setMessagesOpen(true);
            }}
          >
            <MessageCircle size={18} />
          </button>
          <button
            className="profile-button"
            type="button"
            title="Open your profile"
            onClick={() => openProfile(currentProfile.handle)}
          >
            <UserRound size={18} />
            <span>{currentProfile.name}</span>
          </button>
        </nav>
      </header>

      <div className="sync-status" aria-live="polite">
        {syncStatus}
      </div>

      <button className="search-launcher bottom-action bottom-action-search" type="button" onClick={openSearch}>
        <Search size={17} />
        <span>Search</span>
      </button>

      <section className="stage">
        {selectedProfile ? (
          <ProfileView
            person={selectedProfile}
            items={items}
            isOwnProfile={selectedProfile.handle === currentProfile.handle}
            isFollowing={followingHandles.includes(selectedProfile.handle)}
            onSelect={openPost}
            onOpenProfile={openProfile}
            onAction={applyAction}
            onCommentAction={applyCommentAction}
            onEditComment={(itemId, commentId) => setEditingComment({ itemId, commentId })}
            onDeleteComment={deleteComment}
            onOpenSettings={() => {
              setNotebookOpen(false);
              setTabletOpen(false);
              setComposerOpen(false);
              setSearchOpen(false);
              setMessagesOpen(false);
              setSettingsOpen(true);
            }}
            onToggleFollow={toggleFollow}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            socialLists={profileSocialLists[selectedProfile.handle] ?? { following: [], followers: [] }}
            getProfileRecency={getProfileRecency}
            getProfileCommentRecency={getProfileCommentRecency}
            activeTab={profileActiveTabs[selectedProfile.handle] ?? "all"}
            activityRevision={profileActivityRevision}
            onActiveTabChange={(tab) => changeProfileTab(selectedProfile.handle, tab)}
            onEditPost={setEditingPost}
            onDeletePost={deletePost}
            onOpenAttachmentPreview={openAttachmentPreview}
          />
        ) : selectedItem ? (
          <DetailView
            item={selectedItem}
            room={activeRoomData}
            onBack={goBack}
            onOpenProfile={openProfile}
            onAddComment={addComment}
            onAction={applyAction}
            onCommentAction={applyCommentAction}
            onEditComment={(itemId, commentId) => setEditingComment({ itemId, commentId })}
            onDeleteComment={deleteComment}
            onEditPost={setEditingPost}
            onDeletePost={deletePost}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            selectedCommentId={selectedCommentId}
            onClearSelectedComment={() => setSelectedCommentId(null)}
            commentSegmentStacks={commentSegmentStacks}
            onCommentSegmentStackChange={updateCommentSegmentStack}
            onVisibleCommentSegmentStackChange={registerVisibleCommentSegmentStack}
            onOpenAttachmentPreview={openAttachmentPreview}
          />
        ) : activeRoom === "hall" ? (
          <HallView onEnter={enterRoom} />
        ) : activeRoom === "office" && officeMode === "desk" ? (
          <OfficeDeskView
            room={activeRoomData}
            onOpenSaved={() => toggleOfficeMode("saved")}
            onOpenNotes={() => toggleOfficeMode("notes")}
          />
        ) : activeRoom === "funding" && patronageMode === "lobby" ? (
          <PatronageLobbyView
            room={activeRoomData}
            onOpenCivic={() => openPatronageMode("civic")}
            onOpenPrivate={() => openPatronageMode("private")}
          />
        ) : activeRoom === "communities" && selectedCommunity ? (
          <SelectedCommunityView
            community={selectedCommunity}
            items={items}
            currentProfile={currentProfile}
            profiles={profiles}
            onBack={closeCommunity}
            onSelect={openPost}
            onOpenProfile={openProfile}
            onAction={applyAction}
            onEditPost={setEditingPost}
            onDeletePost={deletePost}
            onOpenAttachmentPreview={openAttachmentPreview}
            onDummyCall={(mode) => setSyncStatus(`${mode} call placeholder`)}
          />
        ) : activeRoom === "communities" ? (
          <CommunitiesDirectoryView
            communities={researchCommunities}
            items={items}
            currentProfile={currentProfile}
            query={communityQuery}
            onQuery={setCommunityQuery}
            expanded={communitiesExpanded}
            onExpanded={setCommunitiesExpanded}
            onOpenCommunity={openCommunity}
          />
        ) : (
          <RoomView
            room={activeRoomData}
            items={visibleItems}
            officeMode={activeRoom === "office" ? officeMode : undefined}
            patronageMode={activeRoom === "funding" ? patronageMode : undefined}
            feedScope={feedScope}
            roomChip={roomChip}
            onFeedScope={setFeedScope}
            onRoomChip={setRoomChip}
            onPatronageMode={openPatronageMode}
            onSelect={openPost}
            onOpenProfile={openProfile}
            onAction={applyAction}
            onEditPost={setEditingPost}
            onDeletePost={deletePost}
            onOpenNotes={() => toggleOfficeMode("notes")}
            onOpenSaved={() => toggleOfficeMode("saved")}
            actorHandle={currentProfile.handle}
            profiles={profiles}
            onOpenAttachmentPreview={openAttachmentPreview}
          />
        )}
      </section>

      <button
        className="new-post-launcher bottom-action bottom-action-new"
        type="button"
        onClick={() => {
          setNotebookOpen(false);
          setTabletOpen(false);
          setSettingsOpen(false);
          setSearchOpen(false);
          setMessagesOpen(false);
          setComposerOpen(true);
        }}
      >
        <NotebookPen size={18} />
        <span>New post</span>
      </button>

      <button
        className="pocket pocket-left bottom-action bottom-action-notebook"
        type="button"
        title="Notebook"
        onClick={openNotebook}
      >
        <NotebookPen size={18} />
        <span>Notebook</span>
      </button>

      <button
        className="pocket pocket-right bottom-action bottom-action-tablet"
        type="button"
        title="AI tablet"
        onClick={openTablet}
      >
        <BrainCircuit size={18} />
        <span>AI Tablet</span>
      </button>

      {notebookOpen ? (
        <NotebookPanel
          noteText={noteText}
          setNoteText={setNoteText}
          context={selectedItem?.title ?? activeRoomData.name}
          onClose={() => setNotebookOpen(false)}
        />
      ) : null}

      {tabletOpen ? (
        <TabletPanel
          context={currentContext}
          selectedItem={selectedItem}
          room={activeRoomData}
          onClose={() => setTabletOpen(false)}
        />
      ) : null}

      {messagesOpen ? <MessagesModal onClose={() => setMessagesOpen(false)} /> : null}

      {composerOpen ? (
        <PostComposerModal
          onClose={() => setComposerOpen(false)}
          onCreatePost={createPost}
          onUploadAttachment={uploadPostAttachment}
        />
      ) : null}

      {editingPostItem ? (
        <PostEditModal
          key={editingPostItem.id}
          item={editingPostItem}
          onClose={() => setEditingPost(null)}
          onSave={savePostEdit}
          onDelete={deletePost}
        />
      ) : null}

      {editingComment && editingCommentItem && editingCommentValue && !isDeletedComment(editingCommentValue) ? (
        <CommentEditModal
          key={`${editingComment.itemId}:${editingComment.commentId}`}
          item={editingCommentItem}
          comment={editingCommentValue}
          onClose={() => setEditingComment(null)}
          onSave={saveCommentEdit}
          onDelete={deleteComment}
        />
      ) : null}

      {attachmentPreview && attachmentPreviewItem ? (
        <AttachmentPreviewModal
          item={attachmentPreviewItem}
          attachmentId={attachmentPreview.attachmentId}
          onClose={() => setAttachmentPreview(null)}
        />
      ) : null}

      {searchOpen ? (
        <SearchModal
          query={searchQuery}
          setQuery={setSearchQuery}
          results={searchResults}
          onClose={() => setSearchOpen(false)}
          onOpenPost={(id) => {
            setSearchOpen(false);
            openPost(id, null, "search");
          }}
          onOpenProfile={(name) => {
            setSearchOpen(false);
            openProfile(name);
          }}
        />
      ) : null}

      {settingsOpen ? (
        <ProfileSettingsModal
          currentProfile={currentProfile}
          onClose={() => setSettingsOpen(false)}
          onSave={saveProfileSettings}
          onUploadAvatar={uploadProfileAvatar}
          onSignOut={signOut}
        />
      ) : null}
    </main>
  );
}

function EntrySequence({
  theme,
  entranceRender,
  mode,
  authError,
  authLoaded,
  clerkEnabled,
  onLocalPreview,
  preloadRenders
}: {
  theme: Theme;
  entranceRender: string;
  mode: EntryMode;
  authError: string;
  authLoaded: boolean;
  clerkEnabled: boolean;
  onLocalPreview: () => void;
  preloadRenders: string[];
}) {
  return (
    <main className={`entry-sequence ${theme}`} aria-label="Approaching Symposium">
      <Image
        src={entranceRender}
        alt="Greco-futurist Symposium building above the Aegean sea"
        fill
        priority
        sizes="100vw"
        className="entry-image"
      />
      <RenderPreloadDeck sources={preloadRenders} />
      <div className="entry-veil" />
      <div className="entry-stair-lines" aria-hidden="true">
        {Array.from({ length: 9 }).map((_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className="entry-copy">
        <p>Welcome to the Symposium</p>
      </div>
      {mode === "auth" ? (
        <EntryAuthPanel
          authError={authError}
          authLoaded={authLoaded}
          clerkEnabled={clerkEnabled}
          onLocalPreview={onLocalPreview}
        />
      ) : null}
    </main>
  );
}

function EntryAuthPanel({
  authError,
  authLoaded,
  clerkEnabled,
  onLocalPreview
}: {
  authError: string;
  authLoaded: boolean;
  clerkEnabled: boolean;
  onLocalPreview: () => void;
}) {
  return (
    <section className="entry-auth" aria-label="Symposium sign in">
      {clerkEnabled ? (
        <div className="entry-auth-form clerk-auth-actions">
          <SignInButton mode="modal">
            <button type="button" disabled={!authLoaded}>
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button type="button" disabled={!authLoaded}>
              Create account
            </button>
          </SignUpButton>
        </div>
      ) : (
        <div className="entry-auth-form">
          <button type="button" onClick={onLocalPreview} disabled={!authLoaded}>
            Enter local preview
          </button>
        </div>
      )}

      {authError ? <p className="auth-error">{authError}</p> : null}
    </section>
  );
}

function HallView({ onEnter }: { onEnter: (roomId: RoomId) => void }) {
  const doorIds: Array<Exclude<RoomId, "hall">> = [
    "office",
    "amphitheater",
    "funding",
    "library",
    "communities",
    "symposium",
    "opportunities"
  ];

  return (
    <div className="hall-layout">
      <section className="hall-world" aria-label="Main hall">
        {doorIds.map((roomId) => {
          const room = getRoom(roomId);
          return (
            <button
              key={room.id}
              className={`hall-door hall-door-${room.id}`}
              type="button"
              aria-label={`Enter ${room.name}`}
              onClick={() => onEnter(room.id)}
            >
              <span className="hall-hover-label">{room.name}</span>
            </button>
          );
        })}
      </section>
    </div>
  );
}

function ViewNav({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onHome
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onHome: () => void;
}) {
  return (
    <nav className="view-nav" aria-label="View history">
      <button type="button" title="Back" disabled={!canGoBack} onClick={onBack}>
        <ArrowLeft size={17} />
      </button>
      <button type="button" title="Forward" disabled={!canGoForward} onClick={onForward}>
        <ArrowRight size={17} />
      </button>
      <button type="button" title="Main hall" onClick={onHome}>
        <Home size={17} />
      </button>
    </nav>
  );
}

function OfficeDeskView({
  room,
  onOpenSaved,
  onOpenNotes
}: {
  room: Room;
  onOpenSaved: () => void;
  onOpenNotes: () => void;
}) {
  return (
    <div className="office-desk-view">
      <RoomRender room={room} onOpenNotebook={onOpenNotes} onOpenSaved={onOpenSaved} />
    </div>
  );
}

function PatronageLobbyView({
  room,
  onOpenCivic,
  onOpenPrivate
}: {
  room: Room;
  onOpenCivic: () => void;
  onOpenPrivate: () => void;
}) {
  return (
    <div className="patronage-lobby-view">
      <RoomRender
        room={room}
        onOpenNotebook={() => undefined}
        onOpenCivic={onOpenCivic}
        onOpenPrivate={onOpenPrivate}
        showPatronageHotspots
      />
    </div>
  );
}

function CommunitiesDirectoryView({
  communities,
  items,
  currentProfile,
  query,
  onQuery,
  expanded,
  onExpanded,
  onOpenCommunity
}: {
  communities: ResearchCommunity[];
  items: InquiryItem[];
  currentProfile: ResearchProfile;
  query: string;
  onQuery: (query: string) => void;
  expanded: boolean;
  onExpanded: (expanded: boolean) => void;
  onOpenCommunity: (communityId: string) => void;
}) {
  const term = normalizeSearchPhrase(query);
  const matches = (community: ResearchCommunity) => !term || communitySearchText(community).includes(term);
  const memberships = communityMembershipIds(communities, currentProfile);
  const myCommunities = communities.filter((community) => memberships.has(community.id) && matches(community));
  const discoverCommunities = communities
    .filter((community) => !memberships.has(community.id) && matches(community))
    .sort((a, b) => b.online - a.online);
  const canExpandMyCommunities = myCommunities.length > 6;
  const visibleMyCommunities = expanded ? myCommunities : myCommunities.slice(0, 6);
  const visibleDiscover = discoverCommunities;

  return (
    <section className="communities-layout" aria-label="Communities">
      <aside className="communities-context">
        <p className="eyebrow">Directory</p>
        <h1>Communities</h1>
        <p>Find the groups around shared work, live calls, and public artifacts.</p>
      </aside>
      <div className="communities-panel">
        <label className="communities-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search communities"
            aria-label="Search communities"
          />
        </label>

        <CommunityLayer
          title="Your communities"
          communities={visibleMyCommunities}
          items={items}
          expanded={expanded}
          total={myCommunities.length}
          onToggle={canExpandMyCommunities ? () => onExpanded(!expanded) : undefined}
          onOpenCommunity={onOpenCommunity}
          emptyText="Join communities to keep them here."
        />

        <CommunityLayer
          title="Discover"
          communities={visibleDiscover}
          items={items}
          total={discoverCommunities.length}
          onOpenCommunity={onOpenCommunity}
          emptyText="No community matches yet."
        />
      </div>
    </section>
  );
}

function CommunityLayer({
  title,
  communities,
  items,
  total,
  expanded,
  onToggle,
  onOpenCommunity,
  emptyText
}: {
  title: string;
  communities: ResearchCommunity[];
  items: InquiryItem[];
  total: number;
  expanded?: boolean;
  onToggle?: () => void;
  onOpenCommunity: (communityId: string) => void;
  emptyText: string;
}) {
  return (
    <section className="community-layer">
      <header>
        <button type="button" onClick={onToggle ?? (() => undefined)} disabled={!onToggle}>
          {onToggle ? <ArrowRight size={16} className={expanded ? "expanded" : ""} /> : null}
          <span>{title}</span>
          <small>{total}</small>
        </button>
      </header>
      {communities.length ? (
        <div className="community-grid">
          {communities.map((community) => (
            <CommunityCard
              key={community.id}
              community={community}
              stats={getCommunityStats(items, community)}
              onOpenCommunity={onOpenCommunity}
            />
          ))}
        </div>
      ) : (
        <p className="community-empty">{emptyText}</p>
      )}
    </section>
  );
}

function CommunityCard({
  community,
  stats,
  onOpenCommunity
}: {
  community: ResearchCommunity;
  stats: ReturnType<typeof getCommunityStats>;
  onOpenCommunity: (communityId: string) => void;
}) {
  return (
    <button
      className={`community-card community-card-${community.visibility}`}
      type="button"
      onClick={() => onOpenCommunity(community.id)}
    >
      <span className="community-card-topline">
        <strong>{community.name}</strong>
        <small>{community.visibility}</small>
      </span>
      <span className="community-field">{community.field}</span>
      <span className="community-summary">{community.summary}</span>
      <span className="community-stats">
        <small>{community.online} online</small>
        <small>{stats.papers} papers</small>
        <small>{stats.thoughts} thoughts</small>
        <small>{stats.opportunities} opportunities</small>
      </span>
    </button>
  );
}

function SelectedCommunityView({
  community,
  items,
  currentProfile,
  profiles,
  onBack,
  onSelect,
  onOpenProfile,
  onAction,
  onEditPost,
  onDeletePost,
  onOpenAttachmentPreview,
  onDummyCall
}: {
  community: ResearchCommunity;
  items: InquiryItem[];
  currentProfile: ResearchProfile;
  profiles: Record<string, ResearchProfile>;
  onBack: () => void;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
  onDummyCall: (mode: "Voice" | "Video") => void;
}) {
  const memberships = communityMembershipIds(researchCommunities, currentProfile);
  const isMember = memberships.has(community.id);
  const relatedItems = sortCommunityItems(getCommunityItems(items, community));

  return (
    <section className="selected-community-layout" aria-label={community.name}>
      <div className="selected-community-panel">
        <button className="community-back" type="button" onClick={onBack}>
          <ArrowLeft size={17} />
          Communities
        </button>
        <header className="selected-community-header">
          <p className="eyebrow">{community.visibility} community</p>
          <h1>{community.name}</h1>
          <p>{community.summary}</p>
          <span>{community.field}</span>
        </header>

        <section className="community-call-panel" aria-label="Community calls">
          <div>
            <strong>Group call</strong>
            <span>{isMember ? `${community.online} online · ${community.callStatus}` : "members only"}</span>
          </div>
          <button type="button" disabled={!isMember} onClick={() => onDummyCall("Voice")}>
            Voice
          </button>
          <button type="button" disabled={!isMember} onClick={() => onDummyCall("Video")}>
            Video
          </button>
        </section>
      </div>

      <section className="selected-community-work" aria-label={`${community.name} shared work`}>
        {relatedItems.length ? (
          relatedItems.slice(0, 8).map((item) => (
            <FeedPost
              key={item.id}
              item={item}
              onSelect={onSelect}
              onOpenProfile={onOpenProfile}
              onAction={onAction}
              onEditPost={onEditPost}
              onDeletePost={onDeletePost}
              onOpenAttachmentPreview={onOpenAttachmentPreview}
              actorHandle={currentProfile.handle}
              profiles={profiles}
              surface="community"
            />
          ))
        ) : (
          <div className="empty-feed">
            <strong>No shared work yet.</strong>
            <span>This community will fill as linked papers, thoughts, and opportunities appear.</span>
          </div>
        )}
      </section>
    </section>
  );
}

const sortCommunityItems = (items: InquiryItem[]) =>
  [...items].sort((a, b) => itemTimestampScore(b) - itemTimestampScore(a));

function RoomView({
  room,
  items,
  officeMode,
  patronageMode,
  feedScope,
  roomChip,
  onFeedScope,
  onRoomChip,
  onPatronageMode,
  onSelect,
  onOpenProfile,
  onAction,
  onEditPost,
  onDeletePost,
  onOpenNotes,
  onOpenSaved,
  actorHandle,
  profiles,
  onOpenAttachmentPreview
}: {
  room: Room;
  items: InquiryItem[];
  officeMode?: OfficeMode;
  patronageMode?: PatronageMode;
  feedScope: FeedScope;
  roomChip: string;
  onFeedScope: (scope: FeedScope) => void;
  onRoomChip: (chip: string) => void;
  onPatronageMode: (mode: PatronageMode) => void;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenNotes: () => void;
  onOpenSaved: () => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
}) {
  const roomTitle =
    room.id === "funding" && patronageMode === "civic"
      ? "Civic Patronage"
      : room.id === "funding" && patronageMode === "private"
        ? "Private Patronage"
        : officeMode === "saved"
          ? "Saved for later"
          : officeMode === "notes"
            ? "Notes"
            : room.name;
  const roomDescription =
    room.id === "funding" && patronageMode === "civic"
      ? "Crowdfunding, bounties, donations, microgrants, and public backing for work that deserves early oxygen."
      : room.id === "funding" && patronageMode === "private"
        ? "Investors, grants, family offices, funds, and larger patronage routes for serious research and institutions."
        : officeMode === "saved"
          ? "Work you marked for return."
          : officeMode === "notes"
            ? "Your desk notes and authored fragments."
            : room.description;

  return (
    <div className="room-layout">
      <RoomRender room={room} onOpenNotebook={onOpenNotes} onOpenSaved={onOpenSaved} />

      <section className="feed-toolbar" aria-label="Feed controls">
        {room.id === "funding" && patronageMode !== "lobby" ? (
          <button className="community-back patronage-back" type="button" onClick={() => onPatronageMode("lobby")}>
            <ArrowLeft size={16} />
            Patronage
          </button>
        ) : null}

        <div className="room-mini-title">
          <p className="eyebrow">{room.eyebrow}</p>
          <h1>{roomTitle}</h1>
          <p>{roomDescription}</p>
        </div>

        {room.id === "funding" ? (
          <div className="segmented patronage-switch" aria-label="Patronage section">
            <button
              type="button"
              className={patronageMode === "civic" ? "active" : ""}
              onClick={() => onPatronageMode("civic")}
            >
              Civic
            </button>
            <button
              type="button"
              className={patronageMode === "private" ? "active" : ""}
              onClick={() => onPatronageMode("private")}
            >
              Private
            </button>
          </div>
        ) : null}

        <div className="segmented">
          {feedScopes.map((scope) => (
            <button
              key={scope.id}
              type="button"
              className={feedScope === scope.id ? "active" : ""}
              onClick={() => onFeedScope(scope.id)}
            >
              {scope.label}
            </button>
          ))}
        </div>

        {feedScope === "rooms" ? (
          <label className="topic-select">
            <span>Topic</span>
            <select value={roomChip} onChange={(event) => onRoomChip(event.target.value)}>
              {roomChips.map((chip) => (
                <option key={chip} value={chip}>
                  {chip}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {room.id === "office" ? (
          <div className="office-feed-note">
            {officeMode === "saved" ? "Saved items are sorted by your latest action." : "Notes are local for now."}
          </div>
        ) : null}
      </section>

      <section className="feed-stream" aria-label={`${room.name} feed`}>
        {items.length ? (
          items.map((item) => (
            <FeedPost
              key={item.id}
              item={item}
              onSelect={onSelect}
              onOpenProfile={onOpenProfile}
              onAction={onAction}
              onEditPost={onEditPost}
              onDeletePost={onDeletePost}
              actorHandle={actorHandle}
              profiles={profiles}
              onOpenAttachmentPreview={onOpenAttachmentPreview}
            />
          ))
        ) : (
          <div className="empty-feed">
            <strong>No work in this slice yet.</strong>
            <span>Try another room, topic, or search.</span>
          </div>
        )}
      </section>
    </div>
  );
}

function RoomRender({
  room,
  onOpenNotebook,
  onOpenSaved,
  onOpenCivic,
  onOpenPrivate,
  showPatronageHotspots = false
}: {
  room: Room;
  onOpenNotebook: () => void;
  onOpenSaved?: () => void;
  onOpenCivic?: () => void;
  onOpenPrivate?: () => void;
  showPatronageHotspots?: boolean;
}) {
  const isOffice = room.id === "office";
  const isPatronage = room.id === "funding";

  return (
    <section
      className={`room-render room-render-${room.id}`}
      aria-label={`${room.name} rendered room`}
    >
      {isOffice ? (
        <div className="room-hotspots" aria-label="Office desk areas">
          <>
            <button
              className="office-hotspot office-hotspot-notes"
              type="button"
              onClick={onOpenNotebook}
              aria-label="Open notes"
            >
              <span>Notes</span>
            </button>
            <button
              className="office-hotspot office-hotspot-saved"
              type="button"
              onClick={onOpenSaved}
              aria-label="Saved for later"
            >
              <span>Saved for later</span>
            </button>
          </>
        </div>
      ) : null}
      {isPatronage && showPatronageHotspots ? (
        <div className="room-hotspots patronage-hotspots" aria-label="Patronage sections">
          <button
            className="patronage-hotspot patronage-hotspot-civic"
            type="button"
            onClick={onOpenCivic}
            aria-label="Open Civic Patronage"
          >
            <span>Civic</span>
          </button>
          <button
            className="patronage-hotspot patronage-hotspot-private"
            type="button"
            onClick={onOpenPrivate}
            aria-label="Open Private Patronage"
          >
            <span>Private</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

const postKindOptions: PostDraft["kind"][] = ["thought", "paper"];

function PostComposerModal({
  onClose,
  onCreatePost,
  onUploadAttachment
}: {
  onClose: () => void;
  onCreatePost: (draft: PostDraft) => Promise<boolean>;
  onUploadAttachment: (file: File) => Promise<InquiryAttachment>;
}) {
  const [kind, setKind] = useState<PostDraft["kind"]>("thought");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<InquiryAttachment[]>([]);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  const submitPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle || !cleanBody || uploading) return;

    const saved = await onCreatePost({ title: cleanTitle, body: cleanBody, kind, attachments });
    if (!saved) return;
    setTitle("");
    setBody("");
    setKind("thought");
    setAttachments([]);
    setAttachmentStatus("");
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const openSlots = maxPostAttachments - attachments.length;
    const selectedFiles = files.slice(0, Math.max(0, openSlots));
    if (!selectedFiles.length) {
      setAttachmentStatus(`Attachment limit reached (${maxPostAttachments})`);
      return;
    }

    setUploading(true);
    setAttachmentStatus(`Uploading ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"}`);
    try {
      const uploaded: InquiryAttachment[] = [];
      for (const file of selectedFiles) {
        uploaded.push(await onUploadAttachment(file));
      }
      setAttachments((current) => [...current, ...uploaded].slice(0, maxPostAttachments));
      setAttachmentStatus(`${uploaded.length} file${uploaded.length === 1 ? "" : "s"} attached`);
    } catch (error) {
      setAttachmentStatus(error instanceof Error ? error.message : "Could not attach this file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-composer-modal" onSubmit={submitPost} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div>
            <span>New post</span>
            <strong>{kindLabels[kind]}</strong>
          </div>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="composer-topline">
          <select value={kind} onChange={(event) => setKind(event.target.value as PostDraft["kind"])}>
            {postKindOptions.map((option) => (
              <option key={option} value={option}>
                {kindLabels[option]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={uploading}>Post</button>
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write the thing itself"
        />
        <div className="composer-attachments">
          <label className="attachment-picker">
            <Paperclip size={16} />
            <span>{attachments.length}/{maxPostAttachments}</span>
            <input
              type="file"
              multiple
              accept={postAttachmentAccept}
              disabled={uploading || attachments.length >= maxPostAttachments}
              onChange={uploadFiles}
            />
          </label>
          {attachmentStatus ? <small>{attachmentStatus}</small> : null}
          {attachments.length ? (
            <div className="composer-attachment-list">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="composer-attachment-chip">
                  {attachmentIcon(attachment)}
                  <span>{attachment.fileName}</span>
                  <small>{formatAttachmentBytes(attachment.byteSize)}</small>
                  <button
                    type="button"
                    title="Remove attachment"
                    disabled={uploading}
                    onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function PostEditModal({
  item,
  onClose,
  onSave,
  onDelete
}: {
  item: InquiryItem;
  onClose: () => void;
  onSave: (itemId: string, draft: { title: string; body: string }) => void;
  onDelete: (itemId: string) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(item.id, { title, body });
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-edit-modal" onSubmit={submitEdit} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div>
            <span>Edit post</span>
            <strong>{kindLabels[item.kind]}</strong>
          </div>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="composer-topline">
          <button className="danger-action" type="button" onClick={() => onDelete(item.id)}>
            <Trash2 size={16} />
            Delete
          </button>
          <button type="submit">Save</button>
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write the thing itself"
        />
      </form>
    </div>
  );
}

function CommentEditModal({
  item,
  comment,
  onClose,
  onSave,
  onDelete
}: {
  item: InquiryItem;
  comment: InquiryComment;
  onClose: () => void;
  onSave: (itemId: string, commentId: string, body: string) => void;
  onDelete: (itemId: string, commentId: string) => void;
}) {
  const [body, setBody] = useState(comment.body);

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!comment.id) return;
    onSave(item.id, comment.id, body);
  };

  return (
    <div className="composer-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="post-composer post-edit-modal comment-edit-modal" onSubmit={submitEdit} onClick={(event) => event.stopPropagation()}>
        <div className="composer-modal-head">
          <div>
            <span>Edit comment</span>
            <strong>On {deletedPostContextTitle(item)}</strong>
          </div>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="composer-topline">
          <button className="danger-action" type="button" onClick={() => comment.id && onDelete(item.id, comment.id)}>
            <Trash2 size={16} />
            Delete
          </button>
          <button type="submit">Save</button>
        </div>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write the comment"
        />
      </form>
    </div>
  );
}

function PostTimeFooter({ item }: { item: InquiryItem }) {
  if (isDeletedPost(item)) return null;

  const created = localDateTimeLabel(item.createdAt);
  const edited = localDateTimeLabel(item.editedAt);

  if (!created && !edited) return null;

  return (
    <footer className="post-time-footer">
      {created ? <span>Posted {created}</span> : null}
      {edited ? <span>Edited {relativeTimeLabel(item.editedAt)} · {edited}</span> : null}
    </footer>
  );
}

function PostOwnerControls({
  item,
  actorHandle,
  onEditPost,
  onDeletePost
}: {
  item: InquiryItem;
  actorHandle: string;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
}) {
  if (isDeletedPost(item) || cleanHandle(item.authorHandle ?? item.author) !== actorHandle) return null;

  return (
    <div className="post-owner-actions" aria-label="Post owner actions">
      <button
        type="button"
        title="Edit post"
        onClick={(event) => {
          event.stopPropagation();
          onEditPost(item);
        }}
      >
        <Pencil size={16} />
      </button>
      <button
        type="button"
        title="Delete post"
        onClick={(event) => {
          event.stopPropagation();
          onDeletePost(item.id);
        }}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function CommentOwnerControls({
  itemId,
  comment,
  actorHandle,
  onEditComment,
  onDeleteComment
}: {
  itemId: string;
  comment: InquiryComment;
  actorHandle: string;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
}) {
  if (
    !comment.id ||
    isDeletedComment(comment) ||
    cleanHandle(comment.authorHandle ?? comment.author) !== actorHandle
  ) {
    return null;
  }

  return (
    <div className="comment-owner-actions" aria-label="Comment owner actions">
      <button
        type="button"
        title="Edit comment"
        onClick={(event) => {
          event.stopPropagation();
          onEditComment(itemId, comment.id as string);
        }}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        title="Delete comment"
        onClick={(event) => {
          event.stopPropagation();
          onDeleteComment(itemId, comment.id as string);
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function FeedPost({
  item,
  onSelect,
  onOpenProfile,
  onAction,
  onEditPost,
  onDeletePost,
  onOpenAttachmentPreview,
  actorHandle,
  profiles,
  surface = "feed"
}: {
  item: InquiryItem;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  surface?: ViewSurface;
}) {
  const postRef = useRef<HTMLElement | null>(null);
  const openPost = () => onSelect(item.id);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPost();
    }
  };
  useQualifiedView(postRef, {
    disabled: isDeletedPost(item),
    targetKey: item.id,
    onView: () => onAction(item.id, "read", { trigger: "visibility", surface })
  });

  return (
    <article
      ref={postRef}
      className={`feed-post post-kind-${item.kind}`}
      data-testid={`feed-card-${item.id}`}
      role="button"
      tabIndex={0}
      onClick={openPost}
      onKeyDown={onKeyDown}
    >
      <PostOwnerControls item={item} actorHandle={actorHandle} onEditPost={onEditPost} onDeletePost={onDeletePost} />
      <PostAuthor
        item={item}
        profiles={profiles}
        onOpenProfile={onOpenProfile}
        onClickStop={(event) => event.stopPropagation()}
      />
      <div className="post-body">
        <h2>{deletedPostContextTitle(item)}</h2>
        <ExpandableBodyText
          text={item.body}
          className="feed-post-text"
          onExpand={() => onAction(item.id, "read", { trigger: "expand", surface })}
        />
        <PostAttachmentCarousel item={item} onOpenPreview={onOpenAttachmentPreview} />
        <PostTimeFooter item={item} />
        <SocialActions
          item={item}
          commentCount={countComments(item.comments)}
          onAction={onAction}
          onCommentsClick={() => onSelect(item.id, commentsSectionTargetId)}
          actorHandle={actorHandle}
        />
      </div>
    </article>
  );
}

function ExpandableBodyText({
  text,
  className,
  onExpand
}: {
  text: string;
  className?: string;
  onExpand?: () => void;
}) {
  const [visibleLength, setVisibleLength] = useState(() =>
    text.length > collapsedBodyLength ? collapsedBodyLength : text.length
  );
  const hasMore = visibleLength < text.length;
  const isExpanded = text.length > collapsedBodyLength && !hasMore;
  const visibleText = text.slice(0, visibleLength);

  useEffect(() => {
    setVisibleLength(text.length > collapsedBodyLength ? collapsedBodyLength : text.length);
  }, [text]);

  const showMore = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setVisibleLength((current) => Math.min(text.length, current + bodyExpansionStep));
    onExpand?.();
  };

  const showLess = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setVisibleLength(Math.min(collapsedBodyLength, text.length));
  };

  return (
    <p className={`expandable-text ${className ?? ""}`.trim()}>
      {visibleText}
      {hasMore ? (
        <>
          <span> ... </span>
          <button type="button" className="inline-expand-button" onClick={showMore}>
            show more
          </button>
        </>
      ) : isExpanded ? (
        <>
          <span> </span>
          <button type="button" className="inline-expand-button" onClick={showLess}>
            show less
          </button>
        </>
      ) : null}
    </p>
  );
}

function postPreviewAttachments(item: InquiryItem) {
  if (isDeletedPost(item)) return [];
  return (item.attachments ?? []).filter((attachment) => attachment.url);
}

function PostAttachmentCarousel({
  item,
  onOpenPreview,
  variant = "feed"
}: {
  item: InquiryItem;
  onOpenPreview: AttachmentPreviewHandler;
  variant?: "feed" | "detail";
}) {
  const attachments = postPreviewAttachments(item);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeAttachment = attachments[Math.min(activeIndex, Math.max(attachments.length - 1, 0))];

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(attachments.length - 1, 0)));
  }, [attachments.length]);

  if (!attachments.length || !activeAttachment) return null;

  const move = (event: React.MouseEvent<HTMLButtonElement>, direction: -1 | 1) => {
    event.stopPropagation();
    setActiveIndex((current) => (current + direction + attachments.length) % attachments.length);
  };

  const openPreview = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onOpenPreview(item, activeAttachment.id);
  };
  const openOnSingleClick = activeAttachment.kind !== "video";

  return (
    <section className={`post-attachments post-attachments-${variant}`} aria-label="Post attachments">
      <div
        className={`attachment-frame attachment-frame-${activeAttachment.kind}`}
        role="button"
        tabIndex={0}
        draggable={Boolean(activeAttachment.url)}
        onDragStart={startAttachmentDrag(activeAttachment)}
        title={openOnSingleClick ? "Open attachment" : "Double-click to open video"}
        onClick={openOnSingleClick ? openPreview : undefined}
        onDoubleClick={openOnSingleClick ? undefined : openPreview}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenPreview(item, activeAttachment.id);
          }
        }}
      >
        <AttachmentPreviewPane
          attachment={activeAttachment}
          mode={variant === "detail" ? "detail" : "feed"}
          onOpenPreview={openPreview}
        />
      </div>

      <div className="attachment-rail">
        <button
          type="button"
          className="attachment-meta attachment-meta-button"
          draggable={Boolean(activeAttachment.url)}
          onDragStart={startAttachmentDrag(activeAttachment)}
          onClick={openPreview}
          title="Open attachment"
        >
          {attachmentIcon(activeAttachment)}
          <span>{activeAttachment.fileName}</span>
          <small>{formatAttachmentBytes(activeAttachment.byteSize)}</small>
        </button>
        {attachments.length > 1 ? (
          <div className="attachment-controls" aria-label="Attachment navigation">
            <button type="button" title="Previous attachment" onClick={(event) => move(event, -1)}>
              <ChevronLeft size={16} />
            </button>
            <span>{activeIndex + 1}/{attachments.length}</span>
            <button type="button" title="Next attachment" onClick={(event) => move(event, 1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function attachmentIcon(attachment: InquiryAttachment) {
  if (attachment.kind === "image") return <ImageIcon size={15} />;
  if (attachment.kind === "video") return <Film size={15} />;
  if (attachment.kind === "pdf" || attachment.kind === "text" || attachment.kind === "document") {
    return <FileText size={15} />;
  }
  return <Paperclip size={15} />;
}

function AttachmentPreviewPane({
  attachment,
  mode,
  onOpenPreview
}: {
  attachment: InquiryAttachment;
  mode: AttachmentRenderMode;
  onOpenPreview?: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  if (attachment.kind === "image" && attachment.url) {
    return (
      <div className={`attachment-media attachment-media-${mode}`}>
        <img src={attachment.url} alt="" style={attachmentFocalStyle(attachment)} />
      </div>
    );
  }

  if (attachment.kind === "video" && attachment.url) {
    return (
      <div className={`attachment-media attachment-media-${mode}`}>
        <video
          src={attachment.url}
          controls
          playsInline
          preload="metadata"
          style={attachmentFocalStyle(attachment)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenPreview?.(event);
          }}
        />
      </div>
    );
  }

  if (attachment.kind === "pdf" && attachment.url) {
    return <PdfAttachmentPreview attachment={attachment} mode={mode} />;
  }

  if (attachment.kind === "document" && isDocxAttachment(attachment)) {
    return <DocxAttachmentPreview attachment={attachment} mode={mode} />;
  }

  if (attachment.kind === "text" || attachment.kind === "document") {
    return <TextAttachmentPreview attachment={attachment} mode={mode} />;
  }

  return (
    <div className={`attachment-document attachment-document-${mode}`}>
      {attachmentIcon(attachment)}
      <strong>{attachment.fileName}</strong>
      <span>{formatAttachmentBytes(attachment.byteSize)}</span>
    </div>
  );
}

function PdfAttachmentPreview({
  attachment,
  mode,
  zoom = 1
}: {
  attachment: InquiryAttachment;
  mode: AttachmentRenderMode;
  zoom?: number;
}) {
  const pageCount = attachmentPageCount(attachment);
  const [page, setPage] = useState(1);
  const boundedPage = Math.min(page, pageCount);
  const zoomFragment = mode === "expanded" ? `&zoom=${Math.round(zoom * 100)}` : "";
  const source = attachment.url ? `${attachment.url}#page=${boundedPage}${zoomFragment}` : undefined;

  useEffect(() => {
    setPage(1);
  }, [attachment.id]);

  return (
    <div className={`attachment-document attachment-document-${mode} attachment-pdf`}>
      <div className="attachment-pagebar">
        <span>Page {boundedPage}/{pageCount}</span>
        {pageCount > 1 ? (
          <div>
            <button
              type="button"
              title="Previous page"
              disabled={boundedPage <= 1}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              title="Next page"
              disabled={boundedPage >= pageCount}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.min(pageCount, current + 1));
              }}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        ) : null}
      </div>
      {source ? <iframe title={attachment.fileName} src={source} /> : null}
    </div>
  );
}

function TextAttachmentPreview({
  attachment,
  mode,
  zoom = 1
}: {
  attachment: InquiryAttachment;
  mode: AttachmentRenderMode;
  zoom?: number;
}) {
  const previewText = metadataString(attachment.metadata, "previewText");
  const pages = splitPreviewTextIntoPages(previewText);
  const pageCount = attachmentPageCount(attachment, previewText);
  const [page, setPage] = useState(1);
  const boundedPage = Math.min(page, Math.max(pageCount, pages.length));
  const pageText = pages[Math.min(boundedPage - 1, pages.length - 1)] ?? "";

  useEffect(() => {
    setPage(1);
  }, [attachment.id]);

  return (
    <div className={`attachment-document attachment-document-${mode}`}>
      <div className="attachment-pagebar">
        <span>Page {boundedPage}/{Math.max(pageCount, pages.length)}</span>
        {Math.max(pageCount, pages.length) > 1 ? (
          <div>
            <button
              type="button"
              title="Previous page"
              disabled={boundedPage <= 1}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              title="Next page"
              disabled={boundedPage >= Math.max(pageCount, pages.length)}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.min(Math.max(pageCount, pages.length), current + 1));
              }}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        ) : null}
      </div>
      {pageText ? (
        <pre style={mode === "expanded" ? { fontSize: `${0.86 * zoom}rem` } : undefined}>{pageText}</pre>
      ) : (
        <div className="attachment-file-shell">
          {attachmentIcon(attachment)}
          <strong>{attachment.fileName}</strong>
          <span>{formatAttachmentBytes(attachment.byteSize)}</span>
        </div>
      )}
    </div>
  );
}

function DocxAttachmentPreview({
  attachment,
  mode,
  zoom = 1
}: {
  attachment: InquiryAttachment;
  mode: AttachmentRenderMode;
  zoom?: number;
}) {
  const fallbackBlocks = useMemo(
    () => plainTextToDocxBlocks(metadataString(attachment.metadata, "previewText")),
    [attachment.metadata]
  );
  const fallbackPages = paginateDocxBlocks(fallbackBlocks);
  const metadataPageCount = attachmentPageCount(attachment, metadataString(attachment.metadata, "previewText"));
  const renderTargetRef = useRef<HTMLDivElement>(null);
  const [renderedPageCount, setRenderedPageCount] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const [parseFailed, setParseFailed] = useState(false);
  const totalPages = Math.max(1, renderedPageCount || metadataPageCount || fallbackPages.length);
  const [page, setPage] = useState(1);
  const boundedPage = Math.min(page, totalPages);
  const fallbackPageBlocks = fallbackPages[Math.min(boundedPage - 1, fallbackPages.length - 1)] ?? [];
  const renderedZoom = fitScale * (mode === "expanded" ? clampAttachmentZoom(zoom) : 1);
  const renderedStyle = {
    "--docx-preview-scale": renderedZoom
  } as CSSProperties;

  useEffect(() => {
    setPage(1);
  }, [attachment.id]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const target = renderTargetRef.current;
    if (target) target.replaceChildren();
    setRenderedPageCount(0);
    setFitScale(1);
    setParseFailed(false);

    if (!attachment.url || !target) return;
    const attachmentUrl = attachment.url;

    const loadDocx = async () => {
      try {
        const response = await fetch(attachmentUrl, { cache: "force-cache" });
        if (!response.ok) throw new Error("Could not load document.");
        const bytes = await response.arrayBuffer();
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;

        await renderAsync(bytes, target, target, {
          breakPages: true,
          className: "symposium-docx",
          experimental: true,
          ignoreFonts: false,
          ignoreHeight: false,
          ignoreLastRenderedPageBreak: false,
          ignoreWidth: false,
          inWrapper: true,
          renderComments: false,
          renderEndnotes: true,
          renderFooters: true,
          renderFootnotes: true,
          renderHeaders: true,
          useBase64URL: true
        });

        if (cancelled) return;
        const renderedPages = Array.from(target.querySelectorAll<HTMLElement>("section.symposium-docx"));
        if (!renderedPages.length) throw new Error("Document pages missing.");
        renderedPages.forEach((renderedPage, index) => {
          renderedPage.hidden = index !== 0;
        });
        const firstPageWidth = renderedPages[0]?.getBoundingClientRect().width ?? 0;
        const updateFitScale = () => {
          const availableWidth = Math.max(1, target.clientWidth - 28);
          setFitScale(firstPageWidth > 0 ? Math.min(1, availableWidth / firstPageWidth) : 1);
        };
        updateFitScale();
        resizeObserver = new ResizeObserver(updateFitScale);
        resizeObserver.observe(target);
        setRenderedPageCount(renderedPages.length);
      } catch {
        if (!cancelled) {
          target.replaceChildren();
          setParseFailed(true);
        }
      }
    };

    void loadDocx();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      target.replaceChildren();
    };
  }, [attachment.id, attachment.url, mode]);

  useEffect(() => {
    const target = renderTargetRef.current;
    if (!target || !renderedPageCount) return;
    const renderedPages = Array.from(target.querySelectorAll<HTMLElement>("section.symposium-docx"));
    renderedPages.forEach((renderedPage, index) => {
      renderedPage.hidden = index !== boundedPage - 1;
    });
    target.closest<HTMLElement>(".attachment-docx-scroll")?.scrollTo({ top: 0, left: 0 });
  }, [boundedPage, renderedPageCount]);

  return (
    <div className={`attachment-document attachment-document-${mode} attachment-docx`}>
      <div className="attachment-pagebar">
        <span>Page {boundedPage}/{totalPages}</span>
        {totalPages > 1 ? (
          <div>
            <button
              type="button"
              title="Previous page"
              disabled={boundedPage <= 1}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              title="Next page"
              disabled={boundedPage >= totalPages}
              onClick={(event) => {
                event.stopPropagation();
                setPage((current) => Math.min(totalPages, current + 1));
              }}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="attachment-docx-scroll">
        <div
          ref={renderTargetRef}
          className="attachment-docx-rendered"
          style={renderedStyle}
          aria-label={`${attachment.fileName} document preview`}
        />
        {!renderedPageCount ? (
          <article className="attachment-docx-page attachment-docx-fallback">
            {fallbackPageBlocks.length ? (
              fallbackPageBlocks.map((block) => (
                <p key={block.id} className={`attachment-docx-block attachment-docx-block-${block.style}`}>
                  {block.style === "list" ? <span className="attachment-docx-bullet" aria-hidden="true">•</span> : null}
                  <span>
                    {block.runs.map((run, runIndex) => (
                      <span
                        key={`${block.id}-${runIndex}`}
                        className={[
                          run.bold ? "attachment-docx-bold" : "",
                          run.italic ? "attachment-docx-italic" : "",
                          run.underline ? "attachment-docx-underline" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {run.text}
                      </span>
                    ))}
                  </span>
                </p>
              ))
            ) : (
              <div className="attachment-file-shell">
                {attachmentIcon(attachment)}
                <strong>{attachment.fileName}</strong>
                <span>{parseFailed ? "Document formatting could not be rendered. Showing the available text preview." : "Preparing original document formatting."}</span>
              </div>
            )}
          </article>
        ) : null}
      </div>
    </div>
  );
}

function ExpandedMediaPreview({
  attachment,
  zoom,
  viewportSize
}: {
  attachment: InquiryAttachment;
  zoom: number;
  viewportSize: AttachmentViewportSize | null;
}) {
  const [intrinsicSize, setIntrinsicSize] = useState<MediaIntrinsicSize | null>(() =>
    attachmentMediaSize(attachment)
  );
  const mediaSize = fitMediaSizeToViewport(intrinsicSize, viewportSize, clampAttachmentZoom(zoom));
  const mediaStyle = mediaSize
    ? ({
        width: `${mediaSize.width}px`,
        height: `${mediaSize.height}px`
      } satisfies CSSProperties)
    : undefined;
  const mediaShellStyle =
    mediaSize && viewportSize
      ? ({
          width: `${Math.max(mediaSize.width, viewportSize.width)}px`,
          height: `${Math.max(mediaSize.height, viewportSize.height)}px`
        } satisfies CSSProperties)
      : undefined;

  useEffect(() => {
    setIntrinsicSize(attachmentMediaSize(attachment));
  }, [attachment.id]);

  if (attachment.kind === "image" && attachment.url) {
    return (
      <div className="attachment-expanded-media" style={mediaShellStyle}>
        <img
          src={attachment.url}
          alt=""
          style={mediaStyle}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              setIntrinsicSize({ width: image.naturalWidth, height: image.naturalHeight });
            }
          }}
        />
      </div>
    );
  }

  if (attachment.kind === "video" && attachment.url) {
    return (
      <div className="attachment-expanded-media" style={mediaShellStyle}>
        <video
          src={attachment.url}
          controls
          playsInline
          preload="metadata"
          style={mediaStyle}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setIntrinsicSize({ width: video.videoWidth, height: video.videoHeight });
            }
          }}
        />
      </div>
    );
  }

  return null;
}

function AttachmentExpandedPane({
  attachment,
  zoom,
  viewportSize
}: {
  attachment: InquiryAttachment;
  zoom: number;
  viewportSize: AttachmentViewportSize | null;
}) {
  if (attachment.kind === "image" || attachment.kind === "video") {
    return <ExpandedMediaPreview attachment={attachment} zoom={zoom} viewportSize={viewportSize} />;
  }

  if (attachment.kind === "pdf" && attachment.url) {
    return <PdfAttachmentPreview attachment={attachment} mode="expanded" zoom={zoom} />;
  }

  if (attachment.kind === "document" && isDocxAttachment(attachment)) {
    return <DocxAttachmentPreview attachment={attachment} mode="expanded" zoom={zoom} />;
  }

  if (attachment.kind === "text" || attachment.kind === "document") {
    return <TextAttachmentPreview attachment={attachment} mode="expanded" zoom={zoom} />;
  }

  return (
    <div className="attachment-document attachment-document-expanded">
      <div className="attachment-file-shell">
        {attachmentIcon(attachment)}
        <strong>{attachment.fileName}</strong>
        <span>{formatAttachmentBytes(attachment.byteSize)}</span>
      </div>
    </div>
  );
}

function AttachmentPreviewModal({
  item,
  attachmentId,
  onClose
}: {
  item: InquiryItem;
  attachmentId: string;
  onClose: () => void;
}) {
  const attachments = postPreviewAttachments(item);
  const attachmentIdsKey = attachments.map((attachment) => attachment.id).join("|");
  const initialIndex = Math.max(0, attachments.findIndex((attachment) => attachment.id === attachmentId));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeAttachment = attachments[Math.min(activeIndex, Math.max(attachments.length - 1, 0))];
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [stageSize, setStageSize] = useState<AttachmentViewportSize | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveIndex(Math.max(0, attachments.findIndex((attachment) => attachment.id === attachmentId)));
  }, [attachmentId, attachmentIdsKey]);

  useEffect(() => {
    if (!activeAttachment) return;
    setZoom(1);
  }, [activeAttachment?.id]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateStageSize = () => {
      const nextSize = {
        width: stage.clientWidth,
        height: stage.clientHeight
      };
      if (nextSize.width <= 0 || nextSize.height <= 0) return;
      setStageSize((currentSize) =>
        currentSize?.width === nextSize.width && currentSize?.height === nextSize.height ? currentSize : nextSize
      );
    };
    updateStageSize();
    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(stage);
    window.addEventListener("resize", updateStageSize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateStageSize);
    };
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let secondFrame = 0;
    let firstTimeout = 0;
    let secondTimeout = 0;
    const centerStage = () => {
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
    };
    const frame = window.requestAnimationFrame(() => {
      centerStage();
      secondFrame = window.requestAnimationFrame(centerStage);
      firstTimeout = window.setTimeout(centerStage, 60);
      secondTimeout = window.setTimeout(centerStage, 180);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      if (firstTimeout) window.clearTimeout(firstTimeout);
      if (secondTimeout) window.clearTimeout(secondTimeout);
    };
  }, [activeAttachment?.id, stageSize?.height, stageSize?.width, zoom]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === modalRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) onClose();
      if (event.key === "ArrowLeft" && attachments.length > 1) {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + attachments.length) % attachments.length);
      }
      if (event.key === "ArrowRight" && attachments.length > 1) {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % attachments.length);
      }
      if ((event.key === "+" || event.key === "=") && activeAttachment) {
        event.preventDefault();
        setZoom((current) => clampAttachmentZoom(current + zoomInStep));
      }
      if (event.key === "-" && activeAttachment) {
        event.preventDefault();
        setZoom((current) => clampAttachmentZoom(current - zoomOutStep));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeAttachment, attachments.length, onClose]);

  if (!activeAttachment) return null;

  const closeModal = () => {
    if (document.fullscreenElement === modalRef.current) {
      void document.exitFullscreen().then(onClose, onClose);
      return;
    }
    onClose();
  };

  const resetZoom = () => setZoom(1);
  const adjustZoom = (delta: number) => {
    setZoom((current) => clampAttachmentZoom(current + delta));
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === modalRef.current) {
        await document.exitFullscreen();
      } else {
        await modalRef.current?.requestFullscreen();
      }
    } catch {
      setIsFullscreen(false);
    }
  };

  return (
    <div className="attachment-modal-backdrop" role="presentation" onClick={closeModal}>
      <section
        ref={modalRef}
        className="attachment-modal"
        aria-label="Attachment preview"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>{deletedPostContextTitle(item)}</span>
            <strong>{activeAttachment.fileName}</strong>
          </div>
          <button type="button" title="Close" onClick={closeModal}>
            <X size={17} />
          </button>
        </header>

        <div className="attachment-modal-toolbar" aria-label="Attachment viewing controls">
          <div className="attachment-zoom-controls">
            <button type="button" title="Zoom out" onClick={() => adjustZoom(-zoomOutStep)}>
              <ZoomOut size={15} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" title="Zoom in" onClick={() => adjustZoom(zoomInStep)}>
              <ZoomIn size={15} />
            </button>
            <button type="button" title="Reset zoom" onClick={resetZoom}>
              <RotateCcw size={15} />
            </button>
          </div>
          <button type="button" title={isFullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
            {isFullscreen ? <Shrink size={15} /> : <Fullscreen size={15} />}
          </button>
        </div>

        <div
          ref={stageRef}
          className={`attachment-modal-stage attachment-modal-stage-${activeAttachment.kind}`}
          draggable={Boolean(activeAttachment.url)}
          onDragStart={startAttachmentDrag(activeAttachment)}
        >
          <AttachmentExpandedPane attachment={activeAttachment} zoom={zoom} viewportSize={stageSize} />
        </div>

        <footer className="attachment-modal-footer">
          {attachments.length > 1 ? (
            <div className="attachment-modal-navigation">
              <button type="button" title="Previous attachment" onClick={() => setActiveIndex((current) => (current - 1 + attachments.length) % attachments.length)}>
                <ChevronLeft size={17} />
              </button>
              <span>{activeIndex + 1}/{attachments.length}</span>
              <button type="button" title="Next attachment" onClick={() => setActiveIndex((current) => (current + 1) % attachments.length)}>
                <ChevronRight size={17} />
              </button>
            </div>
          ) : (
            <span />
          )}
          <small>{formatAttachmentBytes(activeAttachment.byteSize)}</small>
        </footer>
      </section>
    </div>
  );
}

function PostAuthor({
  item,
  profiles,
  onOpenProfile,
  onClickStop
}: {
  item: InquiryItem;
  profiles: Record<string, ResearchProfile>;
  onOpenProfile: (name: string) => void;
  onClickStop?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  if (isDeletedPost(item)) {
    return (
      <div className="post-author deleted-post-author" aria-label="Deleted post">
        <span className="avatar deleted-avatar" aria-hidden="true" />
        <span>
          <strong aria-hidden="true">—</strong>
        </span>
      </div>
    );
  }

  const authorProfile = profileForHandle(profiles, item.authorHandle ?? item.author);
  const authorName = authorProfile?.name ?? item.author;

  return (
    <button
      className="post-author"
      type="button"
      onClick={(event) => {
        onClickStop?.(event);
        onOpenProfile(authorProfile?.handle ?? item.authorHandle ?? item.author);
      }}
    >
      <span className="avatar">
        {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
      </span>
      <span>
        <strong>{authorName}</strong>
        <small>{relativeTimeLabel(item.createdAt, item.date)}</small>
      </span>
    </button>
  );
}

function SocialActions({
  item,
  commentCount,
  onAction,
  onCommentsClick,
  actorHandle
}: {
  item: InquiryItem;
  commentCount: number;
  onAction: PostActionHandler;
  onCommentsClick?: () => void;
  actorHandle: string;
}) {
  const postDeleted = isDeletedPost(item);
  const savedByActor = isSavedBy(item, actorHandle, profile.handle);
  const signaledByActor = hasHandle(item.signaledBy, actorHandle);
  const forkedByActor = hasHandle(item.forkedBy, actorHandle);
  const actions = [
    { label: "Likes", active: !postDeleted && signaledByActor, value: postDeleted ? deletedMetricLabel : item.metrics.signal, icon: ThumbsUp, action: "signal" as PostAction },
    { label: "Comments", value: postDeleted ? deletedMetricLabel : String(commentCount), icon: MessageCircle, action: null },
    { label: "Reshares", active: !postDeleted && forkedByActor, value: postDeleted ? deletedMetricLabel : item.metrics.forks, icon: Repeat2, action: "fork" as PostAction },
    { label: "Saves", active: !postDeleted && savedByActor, value: postDeleted ? deletedMetricLabel : item.metrics.saves, icon: Bookmark, action: "save" as PostAction },
    { label: "Views", value: postDeleted ? deletedMetricLabel : item.metrics.reads, icon: Eye, action: null }
  ];

  return (
    <div className="social-actions" aria-label="Post actions">
      {actions.map((action) => {
        const Icon = action.icon;
        const fillActiveIcon = action.active && (action.label === "Likes" || action.label === "Saves");
        const disabled = postDeleted && Boolean(action.action);
        const metricValue = action.value === deletedMetricLabel ? deletedMetricLabel : formatMetric(metricNumber(action.value));
        return (
          <button
            key={action.label}
            type="button"
            title={action.label}
            className={action.active ? "active" : ""}
            disabled={disabled}
            onClick={(event) => {
              event.stopPropagation();
              if (action.action && !postDeleted) onAction(item.id, action.action);
              else if (action.label === "Comments") onCommentsClick?.();
            }}
          >
            <Icon size={16} fill={fillActiveIcon ? "currentColor" : "none"} />
            <span className="metric-label">{action.label}</span>
            <strong>{metricValue}</strong>
          </button>
        );
      })}
    </div>
  );
}

function DetailView({
  item,
  room,
  onBack,
  onOpenProfile,
  onAddComment,
  onAction,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  onEditPost,
  onDeletePost,
  actorHandle,
  profiles,
  selectedCommentId,
  onClearSelectedComment,
  commentSegmentStacks,
  onCommentSegmentStackChange,
  onVisibleCommentSegmentStackChange,
  onOpenAttachmentPreview
}: {
  item: InquiryItem;
  room: Room;
  onBack: () => void;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onAction: PostActionHandler;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onClearSelectedComment: () => void;
  commentSegmentStacks: CommentSegmentStacks;
  onCommentSegmentStackChange: (key: string, stack: string[]) => void;
  onVisibleCommentSegmentStackChange: (key: string, stack: string[]) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
}) {
  const isPaper = item.kind === "paper";
  const postDeleted = isDeletedPost(item);
  const detailRef = useRef<HTMLElement | null>(null);
  const doiSlug = item.id.replace(/[^a-z0-9]+/gi, ".").replace(/\.+/g, ".").replace(/\.$/, "");
  const codeSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44);
  const authorProfile = profileForHandle(profiles, item.authorHandle ?? item.author);
  const authorName = authorProfile?.name ?? item.author;
  const commentsSectionId = `comments-${item.id}`;
  const scrollToComments = () => {
    document.getElementById(commentsSectionId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const threadSelectedCommentId = selectedCommentId === commentsSectionTargetId ? null : selectedCommentId;

  useEffect(() => {
    if (selectedCommentId !== commentsSectionTargetId) return;
    window.requestAnimationFrame(scrollToComments);
  }, [selectedCommentId, item.id]);

  useEffect(() => {
    if (!threadSelectedCommentId) return;

    const scrollToSelectedComment = () => {
      document
        .getElementById(`comment-${threadSelectedCommentId}`)
        ?.scrollIntoView({ block: "center", behavior: "auto" });
    };

    window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToSelectedComment));
    const shortTimer = window.setTimeout(scrollToSelectedComment, 120);
    const settledTimer = window.setTimeout(scrollToSelectedComment, 320);

    return () => {
      window.clearTimeout(shortTimer);
      window.clearTimeout(settledTimer);
    };
  }, [commentSegmentStacks, item.id, threadSelectedCommentId]);

  useQualifiedView(detailRef, {
    disabled: postDeleted,
    targetKey: item.id,
    onView: () => onAction(item.id, "read", { trigger: "visibility", surface: "detail" })
  });

  return (
    <article className={`detail-layout ${isPaper ? "paper-detail" : "simple-detail"}`}>
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={17} />
        Back to {room.feedLabel}
      </button>

      <section className="detail-main" ref={detailRef}>
        <PostOwnerControls item={item} actorHandle={actorHandle} onEditPost={onEditPost} onDeletePost={onDeletePost} />
        <p className="eyebrow">{kindLabels[item.kind]}</p>
        <h1>{deletedPostContextTitle(item)}</h1>
        {postDeleted ? (
          <div className="detail-byline-button deleted-post-author" aria-label="Deleted post">
            <span className="avatar deleted-avatar" aria-hidden="true" />
            <span>
              <strong aria-hidden="true">—</strong>
            </span>
          </div>
        ) : (
          <button className="detail-byline-button" type="button" onClick={() => onOpenProfile(authorProfile?.handle ?? item.authorHandle ?? item.author)}>
            <span className="avatar">
              {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
            </span>
            <span>
              <strong>{authorName}</strong>
              <small>{relativeTimeLabel(item.createdAt, item.date)}</small>
            </span>
          </button>
        )}
        <p className="detail-body">{item.body}</p>
        <PostAttachmentCarousel item={item} onOpenPreview={onOpenAttachmentPreview} variant="detail" />
        <PostTimeFooter item={item} />
        <SocialActions
          item={item}
          commentCount={countComments(item.comments)}
          onAction={onAction}
          onCommentsClick={scrollToComments}
          actorHandle={actorHandle}
        />

        <section className="comments-section" id={commentsSectionId}>
          <h2>Discussion</h2>
          {postDeleted ? null : <CommentComposer itemId={item.id} onAddComment={onAddComment} />}
          <CommentThread
            comments={item.comments}
            itemId={item.id}
            profiles={profiles}
            selectedCommentId={threadSelectedCommentId}
            onOpenProfile={onOpenProfile}
            onAddComment={onAddComment}
            onCommentAction={onCommentAction}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
            actorHandle={actorHandle}
            onClearSelectedComment={onClearSelectedComment}
            commentSegmentStacks={commentSegmentStacks}
            onCommentSegmentStackChange={onCommentSegmentStackChange}
            onVisibleCommentSegmentStackChange={onVisibleCommentSegmentStackChange}
          />
        </section>
      </section>

      {isPaper ? (
        <aside className="paper-side">
          <section>
            <h2>Paper</h2>
            <div>
              <span>Collaborators</span>
              <strong>{authorName}</strong>
              <small>Independent reviewers pending</small>
            </div>
            <div>
              <span>DOI</span>
              <strong>10.0000/symposium.{doiSlug}</strong>
            </div>
            <div>
              <span>Code base</span>
              <strong>github.com/symposium-labs/{codeSlug || "paper"}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{item.status}</strong>
            </div>
          </section>
        </aside>
      ) : null}
    </article>
  );
}

function CommentComposer({
  itemId,
  onAddComment,
  parentId,
  compact = false
}: {
  itemId: string;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  parentId?: string | null;
  compact?: boolean;
}) {
  const [body, setBody] = useState("");

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanBody = body.trim();
    if (!cleanBody) return;

    onAddComment(itemId, cleanBody, "Comment", parentId ?? null);
    setBody("");
  };

  return (
    <form className={`comment-composer ${compact ? "compact" : ""}`} onSubmit={submitComment}>
      <div>
        <button type="submit">Add comment</button>
      </div>
        <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={compact ? "Write a reply" : "Add a critique, question, test, or reasoned response"}
      />
    </form>
  );
}

function CommentThread({
  comments,
  itemId,
  profiles,
  selectedCommentId,
  onOpenProfile,
  onAddComment,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  actorHandle,
  onClearSelectedComment,
  commentSegmentStacks,
  onCommentSegmentStackChange,
  onVisibleCommentSegmentStackChange,
  depth = 0
}: {
  comments: InquiryComment[];
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
  onClearSelectedComment: () => void;
  commentSegmentStacks: CommentSegmentStacks;
  onCommentSegmentStackChange: (key: string, stack: string[]) => void;
  onVisibleCommentSegmentStackChange: (key: string, stack: string[]) => void;
  depth?: number;
}) {
  return (
    <div className={`comment-thread depth-${depth}`}>
      {comments.map((comment, index) => {
        const rootStackKey = commentRootStackKey(itemId, comment, index);
        return (
          <CommentRootSegment
            key={rootStackKey}
            rootStackKey={rootStackKey}
            comment={comment}
            itemId={itemId}
            profiles={profiles}
            selectedCommentId={selectedCommentId}
            onOpenProfile={onOpenProfile}
            onAddComment={onAddComment}
            onCommentAction={onCommentAction}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
            actorHandle={actorHandle}
            onClearSelectedComment={onClearSelectedComment}
            segmentStack={commentSegmentStacks[rootStackKey] ?? null}
            onSegmentStackChange={(stack) => onCommentSegmentStackChange(rootStackKey, stack)}
            onVisibleSegmentStackChange={(stack) => onVisibleCommentSegmentStackChange(rootStackKey, stack)}
            depth={depth}
          />
        );
      })}
    </div>
  );
}

function segmentStackForSelectedComment(root: InquiryComment, selectedCommentId: string | null) {
  if (!selectedCommentId) return [];
  const path = findCommentPathById([root], selectedCommentId);
  if (!path) return [];

  const stack: string[] = [];
  let segmentRootIndex = 0;
  while (path.length - segmentRootIndex > maxVisibleCommentPathLength) {
    segmentRootIndex += maxVisibleCommentPathLength - 1;
    const segmentRootId = path[segmentRootIndex]?.id;
    if (!segmentRootId) break;
    stack.push(segmentRootId);
  }

  return stack;
}

function CommentRootSegment({
  rootStackKey,
  comment,
  itemId,
  profiles,
  selectedCommentId,
  onOpenProfile,
  onAddComment,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  actorHandle,
  onClearSelectedComment,
  segmentStack,
  onSegmentStackChange,
  onVisibleSegmentStackChange,
  depth
}: {
  rootStackKey: string;
  comment: InquiryComment;
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
  onClearSelectedComment: () => void;
  segmentStack: string[] | null;
  onSegmentStackChange: (stack: string[]) => void;
  onVisibleSegmentStackChange: (stack: string[]) => void;
  depth: number;
}) {
  const segmentRef = useRef<HTMLDivElement | null>(null);
  const pendingSegmentScrollRef = useRef(false);
  const selectedCommentRouteRef = useRef<string | null>(null);
  const selectedSegmentStack = segmentStackForSelectedComment(comment, selectedCommentId);
  const visibleSegmentStack = segmentStack ?? selectedSegmentStack;
  const activeSegmentId = visibleSegmentStack.at(-1);
  const activeComment = activeSegmentId ? findCommentById([comment], activeSegmentId) ?? comment : comment;

  useEffect(() => {
    if (!selectedCommentId) {
      selectedCommentRouteRef.current = null;
      return;
    }
    const selectedRoute = `${rootStackKey}:${selectedCommentId}`;
    if (selectedCommentRouteRef.current === selectedRoute) return;
    selectedCommentRouteRef.current = selectedRoute;
    const selectedStack = segmentStackForSelectedComment(comment, selectedCommentId);
    const currentStack = segmentStack ?? [];
    if (selectedStack.join("|") === currentStack.join("|")) return;
    onSegmentStackChange(selectedStack);
  }, [comment, onSegmentStackChange, rootStackKey, selectedCommentId, segmentStack]);

  useLayoutEffect(() => {
    onVisibleSegmentStackChange(visibleSegmentStack);
  }, [onVisibleSegmentStackChange, visibleSegmentStack]);

  useLayoutEffect(() => {
    if (!pendingSegmentScrollRef.current || !segmentRef.current) return;
    pendingSegmentScrollRef.current = false;
    segmentRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [visibleSegmentStack]);

  const openReplySegment = (commentId: string) => {
    onClearSelectedComment();
    pendingSegmentScrollRef.current = true;
    if (visibleSegmentStack.at(-1) === commentId) return;
    onSegmentStackChange([...visibleSegmentStack, commentId]);
  };

  const showPreviousSegment = () => {
    onClearSelectedComment();
    pendingSegmentScrollRef.current = true;
    onSegmentStackChange(visibleSegmentStack.slice(0, -1));
  };

  return (
    <div
      className="comment-segment"
      ref={segmentRef}
      data-comment-segment-key={rootStackKey}
      data-comment-segment-stack={JSON.stringify(visibleSegmentStack)}
    >
      <CommentNode
        comment={activeComment}
        itemId={itemId}
        profiles={profiles}
        selectedCommentId={selectedCommentId}
        onOpenProfile={onOpenProfile}
        onAddComment={onAddComment}
        onCommentAction={onCommentAction}
        onEditComment={onEditComment}
        onDeleteComment={onDeleteComment}
        actorHandle={actorHandle}
        depth={depth}
        segmentDepth={1}
        onOpenReplySegment={openReplySegment}
        onClearSelectedComment={onClearSelectedComment}
        leadingAction={
          visibleSegmentStack.length ? (
            <button
              className="reply-window-button reply-window-button-previous"
              type="button"
              onClick={showPreviousSegment}
            >
              Show previous replies
            </button>
          ) : null
        }
      />
    </div>
  );
}

function CommentNode({
  comment,
  itemId,
  profiles,
  selectedCommentId,
  onOpenProfile,
  onAddComment,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  actorHandle,
  depth,
  segmentDepth,
  onOpenReplySegment,
  onClearSelectedComment,
  leadingAction
}: {
  comment: InquiryComment;
  itemId: string;
  profiles: Record<string, ResearchProfile>;
  selectedCommentId: string | null;
  onOpenProfile: (name: string) => void;
  onAddComment: (itemId: string, body: string, stance: string, parentId?: string | null) => void;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
  depth: number;
  segmentDepth: number;
  onOpenReplySegment: (commentId: string) => void;
  onClearSelectedComment: () => void;
  leadingAction?: ReactNode;
}) {
  const [replyOpen, setReplyOpen] = useState(false);
  const replies = comment.replies ?? [];
  const nodeRef = useRef<HTMLElement | null>(null);
  const commentDeleted = isDeletedComment(comment);
  const authorProfile = profileForHandle(profiles, comment.authorHandle ?? comment.author);
  const authorName = authorProfile?.name ?? comment.author;
  const highlighted = Boolean(selectedCommentId && comment.id === selectedCommentId);
  const canShowReplies = segmentDepth < maxVisibleCommentPathLength;
  const shouldHideReplies = replies.length > 0 && !canShowReplies;

  useQualifiedView(nodeRef, {
    disabled: commentDeleted || !comment.id,
    targetKey: comment.id,
    onView: () => {
      if (comment.id) onCommentAction(itemId, comment.id, "read", { trigger: "visibility", surface: "thread" });
    }
  });

  useLayoutEffect(() => {
    if (!highlighted) return;
    window.requestAnimationFrame(() => {
      nodeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [highlighted, selectedCommentId]);

  return (
    <article
      ref={nodeRef}
      id={comment.id ? `comment-${comment.id}` : undefined}
      className="comment"
    >
      {leadingAction ? <div className="comment-leading-action">{leadingAction}</div> : null}
      <div className={`comment-card ${highlighted ? "highlighted" : ""}`}>
        {commentDeleted ? (
          <div className="comment-author deleted-comment-author" aria-label="Deleted comment">
            <span className="avatar small deleted-avatar" aria-hidden="true" />
            <span>
              <strong aria-hidden="true">—</strong>
            </span>
          </div>
        ) : (
          <button type="button" className="comment-author" onClick={() => onOpenProfile(authorProfile?.handle ?? comment.authorHandle ?? comment.author)}>
            <span className="avatar small">
              {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
            </span>
            <span>
              <strong>{authorName}</strong>
              {comment.createdAt ? <small>{relativeTimeLabel(comment.createdAt)}</small> : null}
            </span>
          </button>
        )}
        <CommentOwnerControls
          itemId={itemId}
          comment={comment}
          actorHandle={actorHandle}
          onEditComment={onEditComment}
          onDeleteComment={onDeleteComment}
        />
        <ExpandableBodyText
          text={comment.body}
          className="comment-text"
          onExpand={() => {
            if (comment.id && !commentDeleted) {
              onCommentAction(itemId, comment.id, "read", { trigger: "expand", surface: "thread" });
            }
          }}
        />
        <CommentTimeFooter comment={comment} />
        <CommentActions
          comment={comment}
          itemId={itemId}
          actorHandle={actorHandle}
          onAction={onCommentAction}
        />
        {commentDeleted ? null : (
          <>
            <button className="reply-button" type="button" onClick={() => setReplyOpen((open) => !open)}>
              Reply
            </button>
            {replyOpen ? (
              <CommentComposer
                itemId={itemId}
                parentId={comment.id ?? null}
                compact
                onAddComment={(id, body, stance, parentId) => {
                  onAddComment(id, body, stance, parentId);
                  setReplyOpen(false);
                }}
              />
            ) : null}
          </>
        )}
      </div>
      {shouldHideReplies ? (
        <div className="reply-window">
          {comment.id ? (
            <button
              className="reply-window-button"
              type="button"
              onClick={() => onOpenReplySegment(comment.id as string)}
            >
              Show more replies
            </button>
          ) : null}
        </div>
      ) : replies.length ? (
        <div className="reply-window">
          <div className={`comment-thread depth-${depth + 1}`}>
            {replies.map((reply) => (
              <CommentNode
                key={reply.id ?? `${reply.author}-${reply.stance}-${reply.body}`}
                comment={reply}
                itemId={itemId}
                profiles={profiles}
                selectedCommentId={selectedCommentId}
                onOpenProfile={onOpenProfile}
                onAddComment={onAddComment}
                onCommentAction={onCommentAction}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                actorHandle={actorHandle}
                depth={depth + 1}
                segmentDepth={segmentDepth + 1}
                onOpenReplySegment={onOpenReplySegment}
                onClearSelectedComment={onClearSelectedComment}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function CommentTimeFooter({ comment }: { comment: InquiryComment }) {
  if (isDeletedComment(comment)) return null;

  const created = localDateTimeLabel(comment.createdAt);
  const edited = localDateTimeLabel(comment.editedAt);
  if (!created && !edited) return null;

  return (
    <footer className="comment-time-footer">
      {created ? <span>Posted {created}</span> : null}
      {edited ? <span>Edited {relativeTimeLabel(comment.editedAt)} · {edited}</span> : null}
    </footer>
  );
}

function CommentActions({
  comment,
  itemId,
  actorHandle,
  onAction
}: {
  comment: InquiryComment;
  itemId: string;
  actorHandle: string;
  onAction: (itemId: string, commentId: string, action: CommentAction) => void;
}) {
  if (!comment.id) return null;

  const deleted = isDeletedComment(comment);
  const metrics = { ...commentMetricsFallback, ...(comment.metrics ?? {}) };
  const actions = [
    { label: "Likes", active: commentActionActive(comment, "signal", actorHandle), value: deleted ? deletedMetricLabel : metrics.signal, icon: ThumbsUp, action: "signal" as CommentAction },
    { label: "Comments", value: deleted ? deletedMetricLabel : String(countComments(comment.replies ?? [])), icon: MessageCircle, action: null },
    { label: "Reshares", active: commentActionActive(comment, "fork", actorHandle), value: deleted ? deletedMetricLabel : metrics.forks, icon: Repeat2, action: "fork" as CommentAction },
    { label: "Saves", active: commentActionActive(comment, "save", actorHandle), value: deleted ? deletedMetricLabel : metrics.saves, icon: Bookmark, action: "save" as CommentAction },
    { label: "Views", value: deleted ? deletedMetricLabel : metrics.reads, icon: Eye, action: null }
  ];

  return (
    <div className="comment-actions" aria-label="Comment actions">
      {actions.map((action) => {
        const Icon = action.icon;
        const fillActiveIcon = action.active && (action.label === "Likes" || action.label === "Saves");
        return (
          <button
            key={action.label}
            type="button"
            title={action.label}
            className={`${action.active ? "active" : ""}${deleted ? " disabled" : ""}`}
            disabled={deleted || !action.action}
            onClick={(event) => {
              event.stopPropagation();
              if (!deleted && action.action) onAction(itemId, comment.id as string, action.action);
            }}
          >
            <Icon size={15} fill={fillActiveIcon ? "currentColor" : "none"} />
            <span>{action.label}</span>
            <strong>{deleted ? deletedMetricLabel : formatMetric(metricNumber(action.value))}</strong>
          </button>
        );
      })}
    </div>
  );
}

function NotebookPanel({
  noteText,
  setNoteText,
  context,
  onClose
}: {
  noteText: string;
  setNoteText: (text: string) => void;
  context: string;
  onClose: () => void;
}) {
  return (
    <aside className="side-panel notebook-panel">
      <PanelHeader icon={<NotebookPen size={18} />} title="Notebook" onClose={onClose} />
      <p className="panel-context">{context}</p>
      <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} />
      <div className="note-stack">
        <span>Draft paper margin</span>
        <span>Objection smell test</span>
        <span>Saved replication idea</span>
      </div>
    </aside>
  );
}

function TabletPanel({
  context,
  selectedItem,
  room,
  onClose
}: {
  context: string;
  selectedItem: InquiryItem | null;
  room: Room;
  onClose: () => void;
}) {
  const prompts = selectedItem
    ? [
        "Find the strongest unresolved objection.",
        "Suggest the next test.",
        "Map the forks worth opening."
      ]
    : [
        `Summarize the live work in ${room.name}.`,
        "What should be saved for later?",
        "Which claim needs critique first?"
      ];

  return (
    <aside className="side-panel tablet-panel">
      <PanelHeader icon={<BrainCircuit size={18} />} title="AI Tablet" onClose={onClose} />
      <p className="panel-context">{context}</p>
      <section className="tablet-lens">
        <span>Context lens</span>
        <strong>{selectedItem ? selectedItem.status : room.feedLabel}</strong>
      </section>
      <div className="prompt-stack">
        {prompts.map((prompt) => (
          <button type="button" key={prompt}>
            <Sparkles size={15} />
            {prompt}
          </button>
        ))}
      </div>
      <form className="tablet-input">
        <input placeholder="Ask from the current room" />
        <button type="button" title="Send">
          <Send size={17} />
        </button>
      </form>
    </aside>
  );
}

function ProfileView({
  person,
  items,
  isOwnProfile,
  isFollowing,
  onSelect,
  onOpenProfile,
  onAction,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  onOpenSettings,
  onToggleFollow,
  actorHandle,
  profiles,
  socialLists,
  getProfileRecency,
  getProfileCommentRecency,
  activeTab,
  activityRevision,
  onActiveTabChange,
  onEditPost,
  onDeletePost,
  onOpenAttachmentPreview
}: {
  person: ResearchProfile;
  items: InquiryItem[];
  isOwnProfile: boolean;
  isFollowing: boolean;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onAction: PostActionHandler;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  onOpenSettings: () => void;
  onToggleFollow: (handle: string) => void;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  socialLists: ProfileSocialLists;
  getProfileRecency: (item: InquiryItem, handle: string, kind: ProfileActivityKind) => number;
  getProfileCommentRecency: (
    item: InquiryItem,
    comment: InquiryComment,
    handle: string,
    kind: ProfileCommentActivityKind
  ) => number;
  activeTab: ProfileTab;
  activityRevision: number;
  onActiveTabChange: (tab: ProfileTab) => void;
  onEditPost: (item: InquiryItem) => void;
  onDeletePost: (itemId: string) => void;
  onOpenAttachmentPreview: AttachmentPreviewHandler;
}) {
  const [activeSocialList, setActiveSocialList] = useState<"following" | "followers" | null>(null);
  const [visibleSlots, setVisibleSlots] = useState<ProfileActivitySlot[]>([]);
  const byPublishedRecency = (nextItems: InquiryItem[]) =>
    [...nextItems].sort((a, b) => getProfileRecency(b, person.handle, "authored") - getProfileRecency(a, person.handle, "authored"));
  const byProfileRecency = (nextItems: InquiryItem[], kind: ProfileActivityKind) =>
    [...nextItems].sort((a, b) => getProfileRecency(b, person.handle, kind) - getProfileRecency(a, person.handle, kind));
  const postEntry = (item: InquiryItem, recency: number): ProfileActivityEntry => ({
    id: `post:${item.id}`,
    type: "post",
    item,
    recency
  });
  const commentEntry = (activity: ProfileCommentActivity): ProfileActivityEntry => ({
    id: `comment:${activity.id}`,
    type: "comment",
    activity,
    recency: activity.recency
  });
  const sortEntries = (entries: ProfileActivityEntry[]) => [...entries].sort((a, b) => b.recency - a.recency);
  const entryToSlot = (entry: ProfileActivityEntry): ProfileActivitySlot =>
    entry.type === "post"
      ? { id: entry.id, type: "post", itemId: entry.item.id, recency: entry.recency }
      : {
          id: entry.id,
          type: "comment",
          itemId: entry.activity.item.id,
          commentId: entry.activity.comment.id as string,
          kind: entry.activity.kind,
          label: entry.activity.label,
          recency: entry.recency
        };
  const isAuthor = (item: InquiryItem) => itemAuthoredByProfile(item, person);
  const canShowLikes = actorHandle === person.handle || inferredLikesPublic(person);
  const canShowReshares = actorHandle === person.handle || inferredResharesPublic(person);
  const canShowSaved = actorHandle === person.handle;
  const authored = byPublishedRecency(items.filter(isAuthor));
  const papers = authored.filter((item) => item.kind === "paper");
  const thoughts = authored.filter((item) => item.kind === "thought" || item.kind === "note");
  const commentRecency = (item: InquiryItem, comment: InquiryComment, kind: ProfileCommentActivityKind) =>
    getProfileCommentRecency(item, comment, person.handle, kind);
  const commentActivities = collectProfileComments(items, person, "comments", commentRecency);
  const commentReshares = canShowReshares ? collectProfileComments(items, person, "fork", commentRecency) : [];
  const commentLikes = canShowLikes ? collectProfileComments(items, person, "signal", commentRecency) : [];
  const commentSaved = canShowSaved ? collectProfileComments(items, person, "save", commentRecency) : [];
  const reshares = canShowReshares
    ? byProfileRecency(items.filter((item) => !isDeletedPost(item) && !isAuthor(item) && hasHandle(item.forkedBy, person.handle)), "fork")
    : [];
  const likes = canShowLikes
    ? byProfileRecency(items.filter((item) => !isDeletedPost(item) && !isAuthor(item) && hasHandle(item.signaledBy, person.handle)), "signal")
    : [];
  const saved = canShowSaved ? byProfileRecency(items.filter((item) => !isDeletedPost(item) && !isAuthor(item) && isSavedBy(item, person.handle, profile.handle)), "save") : [];
  const authoredEntries = authored.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const paperEntries = papers.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const thoughtEntries = thoughts.map((item) => postEntry(item, getProfileRecency(item, person.handle, "authored")));
  const reshareEntries = reshares.map((item) => postEntry(item, getProfileRecency(item, person.handle, "fork")));
  const likeEntries = likes.map((item) => postEntry(item, getProfileRecency(item, person.handle, "signal")));
  const savedEntries = saved.map((item) => postEntry(item, getProfileRecency(item, person.handle, "save")));
  const commentEntries = commentActivities.map(commentEntry);
  const commentReshareEntries = commentReshares.map(commentEntry);
  const commentLikeEntries = commentLikes.map(commentEntry);
  const commentSavedEntries = commentSaved.map(commentEntry);
  const allActivity = sortEntries([
    ...authoredEntries,
    ...commentEntries,
    ...reshareEntries,
    ...commentReshareEntries
  ]);

  const tabEntries: Record<ProfileTab, ProfileActivityEntry[]> = {
    all: allActivity,
    papers: paperEntries,
    thoughts: thoughtEntries,
    comments: commentEntries,
    reshares: sortEntries([...reshareEntries, ...commentReshareEntries]),
    likes: sortEntries([...likeEntries, ...commentLikeEntries]),
    saved: sortEntries([...savedEntries, ...commentSavedEntries])
  };

  const tabCounts: Record<ProfileTab, number> = {
    all: allActivity.length,
    papers: papers.length,
    thoughts: thoughts.length,
    comments: commentActivities.length,
    reshares: reshareEntries.length + commentReshareEntries.length,
    likes: likeEntries.length + commentLikeEntries.length,
    saved: savedEntries.length + commentSavedEntries.length
  };

  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "all", label: "All" },
    { id: "papers", label: "Papers" },
    { id: "thoughts", label: "Thoughts" },
    { id: "comments", label: "Comments" },
    ...(canShowReshares ? [{ id: "reshares" as const, label: "Reshares" }] : []),
    ...(canShowLikes ? [{ id: "likes" as const, label: "Likes" }] : []),
    ...(canShowSaved ? [{ id: "saved" as const, label: "Saved" }] : [])
  ];

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) onActiveTabChange("all");
  }, [activeTab, onActiveTabChange, tabs]);

  useLayoutEffect(() => {
    setVisibleSlots(tabEntries[activeTab].map(entryToSlot));
  }, [activeTab, person.handle, activityRevision]);

  const resolveSlot = (slot: ProfileActivitySlot): ProfileActivityEntry | null => {
    const item = items.find((candidate) => candidate.id === slot.itemId);
    if (!item) return null;

    if (slot.type === "post") {
      return { id: slot.id, type: "post", item, recency: slot.recency };
    }

    const comment = findCommentById(item.comments, slot.commentId);
    if (!comment || isDeletedComment(comment)) return null;

    return {
      id: slot.id,
      type: "comment",
      activity: {
        id: `${slot.kind}:${item.id}:${comment.id}`,
        item,
        comment,
        kind: slot.kind,
        label: slot.label,
        recency: slot.recency
      },
      recency: slot.recency
    };
  };

  const visibleEntries = visibleSlots.map(resolveSlot).filter((entry): entry is ProfileActivityEntry => Boolean(entry));

  return (
    <article className="profile-page">
      <section className="profile-hero">
        <span className="avatar large profile-avatar">
          {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initial(person.name)}
        </span>
        <div>
          {isOwnProfile ? (
            <button className="profile-settings-button" type="button" onClick={onOpenSettings}>
              <Settings size={17} />
              <span>Edit profile</span>
            </button>
          ) : (
            <button
              className={`profile-follow-button ${isFollowing ? "active" : ""}`}
              type="button"
              onClick={() => onToggleFollow(person.handle)}
            >
              <UserRound size={17} />
              <span>{isFollowing ? "Following" : "Follow"}</span>
            </button>
          )}
          <h1>{person.name}</h1>
          <p className="profile-handle">{person.handle}</p>
          <p className="profile-bio">{person.bio.slice(0, 200)}</p>
          <div className="profile-social-counts" aria-label={`${person.name} social graph`}>
            <button type="button" onClick={() => setActiveSocialList("following")}>
              <strong>{socialLists.following.length}</strong>
              <span>Following</span>
            </button>
            <button type="button" onClick={() => setActiveSocialList("followers")}>
              <strong>{socialLists.followers.length}</strong>
              <span>Followers</span>
            </button>
          </div>
          <div className="profile-metrics" aria-label={`${person.name} activity totals`}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => onActiveTabChange(tab.id)}
              >
                <strong>{tabCounts[tab.id]}</strong>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="feed-stream profile-stream" aria-label={`${person.name} profile feed`}>
        {visibleEntries.length ? (
          visibleEntries.map((entry) =>
            entry.type === "comment" ? (
              <ProfileCommentCard
                key={entry.id}
                activity={entry.activity}
                profiles={profiles}
                onSelect={onSelect}
                onOpenProfile={onOpenProfile}
                onCommentAction={onCommentAction}
                onEditComment={onEditComment}
                onDeleteComment={onDeleteComment}
                actorHandle={actorHandle}
              />
            ) : (
              <FeedPost
                key={entry.id}
                item={entry.item}
                onSelect={onSelect}
                onOpenProfile={onOpenProfile}
                onAction={onAction}
                onEditPost={onEditPost}
                onDeletePost={onDeletePost}
                actorHandle={actorHandle}
                profiles={profiles}
                surface="profile"
                onOpenAttachmentPreview={onOpenAttachmentPreview}
              />
            )
          )
        ) : (
          <div className="empty-feed">
            <strong>No items here yet.</strong>
            <span>This section will fill as the profile has more activity.</span>
          </div>
        )}
      </section>

      {activeSocialList ? (
        <ProfileSocialListModal
          title={activeSocialList === "following" ? "Following" : "Followers"}
          handles={socialLists[activeSocialList]}
          profiles={profiles}
          onClose={() => setActiveSocialList(null)}
          onOpenProfile={(handle) => {
            setActiveSocialList(null);
            onOpenProfile(handle);
          }}
        />
      ) : null}
    </article>
  );
}

function ProfileCommentCard({
  activity,
  profiles,
  onSelect,
  onOpenProfile,
  onCommentAction,
  onEditComment,
  onDeleteComment,
  actorHandle
}: {
  activity: ProfileCommentActivity;
  profiles: Record<string, ResearchProfile>;
  onSelect: (id: string, commentId?: string | null) => void;
  onOpenProfile: (name: string) => void;
  onCommentAction: CommentActionHandler;
  onEditComment: (itemId: string, commentId: string) => void;
  onDeleteComment: (itemId: string, commentId: string) => void;
  actorHandle: string;
}) {
  const cardRef = useRef<HTMLElement | null>(null);
  const authorProfile = profileForHandle(profiles, activity.comment.authorHandle ?? activity.comment.author);
  const authorName = authorProfile?.name ?? activity.comment.author;
  const commentDeleted = isDeletedComment(activity.comment);
  const openComment = () => {
    if (activity.comment.id && !commentDeleted) {
      onCommentAction(activity.item.id, activity.comment.id, "read", { trigger: "click", surface: "profile" });
    }
    onSelect(activity.item.id, activity.comment.id ?? null);
  };

  useQualifiedView(cardRef, {
    disabled: commentDeleted || !activity.comment.id,
    targetKey: activity.comment.id,
    onView: () => {
      if (activity.comment.id) {
        onCommentAction(activity.item.id, activity.comment.id, "read", { trigger: "visibility", surface: "profile" });
      }
    }
  });

  return (
    <article
      ref={cardRef}
      className="profile-comment-card"
      role="button"
      tabIndex={0}
      onClick={openComment}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openComment();
        }
      }}
    >
      <header>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenProfile(authorProfile?.handle ?? activity.comment.authorHandle ?? activity.comment.author);
          }}
        >
          <span className="avatar small">
            {authorProfile?.avatarUrl ? <img src={authorProfile.avatarUrl} alt="" /> : initial(authorName)}
          </span>
          <span>
            <strong>{authorName}</strong>
            <small>{relativeTimeLabel(activity.comment.createdAt, "Comment")}</small>
          </span>
        </button>
        <div className="profile-comment-header-actions">
          <span>
            <MessageCircle size={15} />
            {activity.label}
          </span>
          <CommentOwnerControls
            itemId={activity.item.id}
            comment={activity.comment}
            actorHandle={actorHandle}
            onEditComment={onEditComment}
            onDeleteComment={onDeleteComment}
          />
        </div>
      </header>
      <ExpandableBodyText
        text={activity.comment.body}
        className="profile-comment-text"
        onExpand={() => {
          if (activity.comment.id) {
            onCommentAction(activity.item.id, activity.comment.id, "read", { trigger: "expand", surface: "profile" });
          }
        }}
      />
      <CommentActions
        comment={activity.comment}
        itemId={activity.item.id}
        actorHandle={actorHandle}
        onAction={onCommentAction}
      />
      <footer>
        <span>On</span>
        <strong>{deletedPostContextTitle(activity.item)}</strong>
        {activity.comment.createdAt ? <em>{localDateTimeLabel(activity.comment.createdAt)}</em> : null}
        {activity.comment.editedAt ? (
          <em>Edited {relativeTimeLabel(activity.comment.editedAt)} · {localDateTimeLabel(activity.comment.editedAt)}</em>
        ) : null}
      </footer>
    </article>
  );
}

function ProfileSocialListModal({
  title,
  handles,
  profiles,
  onClose,
  onOpenProfile
}: {
  title: string;
  handles: string[];
  profiles: Record<string, ResearchProfile>;
  onClose: () => void;
  onOpenProfile: (handle: string) => void;
}) {
  return (
    <div className="modal-backdrop social-list-backdrop" role="presentation" onClick={onClose}>
      <section className="social-list-modal" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="social-list-body">
          {handles.length ? (
            handles.map((handle) => {
              const person = profiles[handle];
              return (
                <button type="button" key={handle} onClick={() => onOpenProfile(handle)}>
                  <span className="avatar small">
                    {person?.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initial(person?.name ?? handle)}
                  </span>
                  <span>
                    <strong>{person?.name ?? handle}</strong>
                    <small>{handle}</small>
                  </span>
                </button>
              );
            })
          ) : (
            <p>No profiles here yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function SearchModal({
  query,
  setQuery,
  results,
  onClose,
  onOpenPost,
  onOpenProfile
}: {
  query: string;
  setQuery: (query: string) => void;
  results: {
    titleMatches: InquiryItem[];
    contentMatches: InquiryItem[];
    profileMatches: ResearchProfile[];
  };
  onClose: () => void;
  onOpenPost: (id: string) => void;
  onOpenProfile: (name: string) => void;
}) {
  const hasQuery = query.trim().length > 0;
  const hasResults =
    results.titleMatches.length || results.contentMatches.length || results.profileMatches.length;

  return (
    <div className="modal-backdrop search-backdrop" role="presentation" onClick={onClose}>
      <section className="search-modal" aria-label="Search Symposium" onClick={(event) => event.stopPropagation()}>
        <header>
          <label>
            <Search size={18} />
            <input
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search posts, comments, people"
            />
          </label>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="search-results">
          {!hasQuery ? (
            <p>Start typing to search across titles, bodies, comments, and profiles.</p>
          ) : hasResults ? (
            <>
              {results.titleMatches.length ? (
                <SearchResultGroup title="Title matches" items={results.titleMatches} onOpenPost={onOpenPost} />
              ) : null}
              {results.contentMatches.length ? (
                <SearchResultGroup title="Content and comments" items={results.contentMatches} onOpenPost={onOpenPost} />
              ) : null}
              {results.profileMatches.length ? (
                <section className="search-group">
                  <h2>People</h2>
                  {results.profileMatches.map((person) => (
                    <button key={person.handle} type="button" onClick={() => onOpenProfile(person.name)}>
                      <span className="avatar small">{initial(person.name)}</span>
                      <span>
                        <strong>{person.name}</strong>
                        <small>{person.role}</small>
                      </span>
                    </button>
                  ))}
                </section>
              ) : null}
            </>
          ) : (
            <p>No results yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function SearchResultGroup({
  title,
  items,
  onOpenPost
}: {
  title: string;
  items: InquiryItem[];
  onOpenPost: (id: string) => void;
}) {
  return (
    <section className="search-group">
      <h2>{title}</h2>
      {items.slice(0, 8).map((item) => (
        <button key={item.id} type="button" onClick={() => onOpenPost(item.id)}>
          <span>{kindLabels[item.kind]}</span>
          <strong>{item.title}</strong>
          <small>
            {item.author} · {item.date}
          </small>
        </button>
      ))}
    </section>
  );
}

function MessagesModal({ onClose }: { onClose: () => void }) {
  const threads = [
    {
      name: "AI Metascience Lab",
      type: "Group",
      preview: "Mira shared the benchmark notes for tomorrow's review.",
      time: "12m"
    },
    {
      name: "Niko Varga",
      type: "Direct",
      preview: "Can you look over the hidden-law task stub?",
      time: "31m"
    },
    {
      name: "Campus Events Board",
      type: "Group",
      preview: "Office hours moved to the civic patronage table.",
      time: "1h"
    },
    {
      name: "Salma Idris",
      type: "Direct",
      preview: "The youth-lab call notes are ready when you are.",
      time: "3h"
    }
  ];

  return (
    <div className="modal-backdrop messages-backdrop" role="presentation" onClick={onClose}>
      <section className="messages-modal" aria-label="Messages" onClick={(event) => event.stopPropagation()}>
        <header>
          <span>
            <MessageCircle size={18} />
            Messages
          </span>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="message-list">
          {threads.map((thread) => (
            <button className="message-thread" type="button" key={`${thread.type}-${thread.name}`}>
              <span className="avatar small">{initial(thread.name)}</span>
              <span>
                <strong>{thread.name}</strong>
                <small>
                  {thread.type} · {thread.time}
                </small>
                <em>{thread.preview}</em>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProfileSettingsModal({
  currentProfile,
  onClose,
  onSave,
  onUploadAvatar,
  onSignOut
}: {
  currentProfile: ResearchProfile;
  onClose: () => void;
  onSave: (draft: ProfileSettingsDraft) => void;
  onUploadAvatar: (file: File) => Promise<string>;
  onSignOut: () => void;
}) {
  const [avatarUrl, setAvatarUrl] = useState(currentProfile.avatarUrl ?? "");
  const [name, setName] = useState(currentProfile.name);
  const [bio, setBio] = useState(currentProfile.bio.slice(0, 200));
  const [likesPublic, setLikesPublic] = useState(inferredLikesPublic(currentProfile));
  const [resharesPublic, setResharesPublic] = useState(inferredResharesPublic(currentProfile));
  const [avatarUploadStatus, setAvatarUploadStatus] = useState("");

  useEffect(() => {
    setAvatarUrl(currentProfile.avatarUrl ?? "");
    setName(currentProfile.name);
    setBio(currentProfile.bio.slice(0, 200));
    setLikesPublic(inferredLikesPublic(currentProfile));
    setResharesPublic(inferredResharesPublic(currentProfile));
    setAvatarUploadStatus("");
  }, [currentProfile]);

  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ avatarUrl, name, bio, likesPublic, resharesPublic });
  };

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAvatarUploadStatus("Uploading photo");
    try {
      const nextAvatarUrl = await onUploadAvatar(file);
      setAvatarUrl(nextAvatarUrl);
      setAvatarUploadStatus("Photo ready");
    } catch (error) {
      setAvatarUploadStatus(error instanceof Error ? error.message : "Could not upload this photo.");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <form className="profile-settings-modal" onSubmit={submitProfile} onClick={(event) => event.stopPropagation()}>
        <header>
          <span>
            <Settings size={18} />
            Profile settings
          </span>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <section className="settings-preview">
          <label className="profile-photo-edit">
            <span className="avatar large profile-avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : initial(name || currentProfile.name)}
              <span className="profile-photo-edit-overlay">Edit</span>
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/avif"
              onChange={uploadAvatar}
            />
          </label>
          <div>
            <strong>{name || currentProfile.name}</strong>
            <small>{currentProfile.handle}</small>
            {avatarUploadStatus ? <em>{avatarUploadStatus}</em> : null}
          </div>
        </section>

        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Bio
          <textarea value={bio} maxLength={200} onChange={(event) => setBio(event.target.value.slice(0, 200))} />
          <small>{bio.length}/200</small>
        </label>
        <label className="setting-toggle">
          <input type="checkbox" checked={likesPublic} onChange={(event) => setLikesPublic(event.target.checked)} />
          Share likes on profile
        </label>
        <label className="setting-toggle">
          <input type="checkbox" checked={resharesPublic} onChange={(event) => setResharesPublic(event.target.checked)} />
          Share reshares on profile
        </label>
        <div className="settings-actions">
          <button type="submit">Save settings</button>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </form>
    </div>
  );
}

function PanelHeader({
  icon,
  title,
  onClose
}: {
  icon: ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <header className="panel-header">
      <span>
        {icon}
        {title}
      </span>
      <button type="button" title="Close" onClick={onClose}>
        <X size={17} />
      </button>
    </header>
  );
}
