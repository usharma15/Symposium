import {
  Amphora,
  Archive,
  BookOpen,
  BrainCircuit,
  Columns3,
  LibraryBig,
  MessagesSquare,
  ScrollText,
  Sparkles
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  ContentQuoteContract,
  ContentQuoteSourceContract,
  ContentKindContract,
  InquiryAttachmentContract,
  InquiryCommentContract,
  InquiryItemContract,
  InquiryMetricsContract,
  ResearchCommunityContract,
  ResearchProfileContract,
  RoomIdContract
} from "@/packages/contracts/src";
import { historicalProfiles, historicalProfilesByHandle, historicalProfilesByName } from "@/lib/historicalWorld/characters";
import { historicalCommunities } from "@/lib/historicalWorld/communities";
import { historicalCommunityActivityItems, historicalInquiryItems } from "@/lib/historicalWorld/content";

export type RoomId = RoomIdContract;
export type FeedScope = "suggested" | "following";
export type ContentKind = ContentKindContract;
export type InquiryComment = InquiryCommentContract;
export type InquiryMetrics = InquiryMetricsContract;
export type InquiryAttachment = InquiryAttachmentContract;
export type ContentQuote = ContentQuoteContract;
export type ContentQuoteSource = ContentQuoteSourceContract;
export type InquiryItem = InquiryItemContract;

export type Room = {
  id: RoomId;
  name: string;
  shortName: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  feedLabel: string;
  location: string;
  ambient: string;
  includes: ContentKind[];
};

export type ResearchProfile = ResearchProfileContract;
export type ResearchCommunity = ResearchCommunityContract;

export const rooms: Room[] = [
  {
    id: "hall", name: "Main Hall", shortName: "Hall", icon: Columns3,
    eyebrow: "Interior threshold", title: "The hall before the rooms.",
    description: "A navigable interior: office to the left, amphitheater farther down, library up the short stair, and the public Symposium room on the right.",
    feedLabel: "Wayfinding", location: "Main hall", ambient: "Footsteps, marble, low voices, sea light through the doors", includes: ["paper", "thought"]
  },
  {
    id: "office", name: "Office", shortName: "Office", icon: Archive,
    eyebrow: "Independent review room", title: "Saved work, drafts, notebooks, code.",
    description: "Your private desk: saved papers, half-built arguments, technical fragments, and things worth returning to.",
    feedLabel: "Saved for later", location: "Left of the main hall", ambient: "Low desk light over marble and paper", includes: ["paper", "thought", "draft", "note", "code"]
  },
  {
    id: "symposium", name: "Symposium", shortName: "Hall", icon: MessagesSquare,
    eyebrow: "Joint inquiry hall", title: "Papers and thoughts in the same room.",
    description: "The public hall where claims gather objections, papers gather forks, and rooms form around live questions.",
    feedLabel: "Mixed feed", location: "Right side of the hall", ambient: "Voices, tablets, chalk, arguments", includes: ["paper", "thought"]
  },
  {
    id: "library", name: "Library", shortName: "Library", icon: LibraryBig,
    eyebrow: "Focused research", title: "Papers only. Reading tables. Slow attention.",
    description: "A cleaner feed for research artifacts: papers, methods, replications, negative results, and field maps.",
    feedLabel: "Paper shelves", location: "Upper floor", ambient: "Quiet light, stacked shelves, private tables", includes: ["paper"]
  },
  {
    id: "amphitheater", name: "Amphitheater", shortName: "Thoughts", icon: Amphora,
    eyebrow: "Thoughts only", title: "Raw claims, objections, quote-posted papers.",
    description: "The rougher public ring for thoughts: strong claims, smell tests, analogies, objections, and questions.",
    feedLabel: "Thought ring", location: "Under the library stair", ambient: "Stone benches, live argument, quick notes", includes: ["thought", "note"]
  },
  {
    id: "funding", name: "Patronage", shortName: "Patronage", icon: Sparkles,
    eyebrow: "Public research patronage", title: "Support serious work before it looks obvious.",
    description: "Public proposals for research, experiments, tools, field work, and institutions that need practical backing.",
    feedLabel: "Patronage Hall", location: "Left under the library stair", ambient: "Quiet negotiations, budgets, small tables, practical pressure", includes: ["paper", "thought", "draft", "note"]
  },
  {
    id: "communities", name: "Communities", shortName: "Communities", icon: MessagesSquare,
    eyebrow: "Campus threshold", title: "Find the groups around shared work.",
    description: "A gateway to communities, calls, events, reading rooms, and live clusters without turning every group into a physical room.",
    feedLabel: "Community paths", location: "Right under the library stair", ambient: "Garden path, moving groups, live invitations", includes: ["paper", "thought", "draft", "note"]
  },
  {
    id: "opportunities", name: "Opportunities", shortName: "Calls", icon: ScrollText,
    eyebrow: "Open calls and roles", title: "Places to join, build, fund, or test.",
    description: "Calls for collaborators, fellowships, events, open problems, internships, grants, and practical next steps.",
    feedLabel: "Opportunity board", location: "Right wall notice board", ambient: "Pinned notices, deadline cards, public invitations", includes: ["paper", "thought", "draft", "note"]
  }
];

export const feedScopes: { id: FeedScope; label: string }[] = [
  { id: "suggested", label: "For you" },
  { id: "following", label: "Following" }
];

export const libraryFolders = [
  { label: "All saved", count: 15, icon: BookOpen },
  { label: "Foundational physics", count: 5, icon: BrainCircuit },
  { label: "Mind, memory, and life", count: 5, icon: ScrollText },
  { label: "Dialogue and institutions", count: 5, icon: Sparkles }
];

export const profile = {
  name: "Udayan Sharma",
  handle: "@udayan",
  role: "Independent researcher",
  location: "Science Rebirth",
  bio: "Building Science Rebirth and Symposium as a living public structure for serious inquiry, objections, forks, and proof-of-work.",
  fields: ["Metascience", "Physics", "AI for science", "Institution design"],
  actorKind: "person"
} satisfies ResearchProfile;

export const profilesByName: Record<string, ResearchProfile> = {
  [profile.name]: profile,
  ...historicalProfilesByName
};

export const profilesByHandle: Record<string, ResearchProfile> = {
  [profile.handle]: profile,
  ...historicalProfilesByHandle
};

export const getProfileForName = (nameOrHandle: string): ResearchProfile =>
  profilesByName[nameOrHandle] ?? profilesByHandle[nameOrHandle] ?? {
    name: nameOrHandle,
    handle: `@${nameOrHandle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    role: "Symposium participant",
    location: "Public rooms",
    bio: "A participant in the current inquiry thread.",
    fields: []
  };

export const researchCommunities: ResearchCommunity[] = historicalCommunities;
export const communityActivityItems: InquiryItem[] = historicalCommunityActivityItems;
export const inquiryItems: InquiryItem[] = historicalInquiryItems;

export const seedProfiles = (): ResearchProfile[] => [profile, ...historicalProfiles];
