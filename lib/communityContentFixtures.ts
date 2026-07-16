import type {
  ContentQuoteContract,
  InquiryCommentContract,
  InquiryItemContract,
  ResearchCommunityContract,
  ResearchProfileContract
} from "@/packages/contracts/src";

const fixtureEpoch = Date.UTC(2026, 6, 16, 15, 30);

const unique = (handles: string[]) => [...new Set(handles)];

const takeRotating = (handles: string[], start: number, count: number) =>
  unique(Array.from({ length: Math.min(count, handles.length) }, (_, index) => handles[(start + index) % handles.length]));

const quoteForPost = (
  source: Pick<InquiryItemContract, "id" | "kind" | "postType" | "title" | "author" | "authorHandle" | "body" | "createdAt">
): ContentQuoteContract => ({
  sourceType: "post",
  sourceId: source.id,
  sourcePostId: source.id,
  sourceRevision: 1,
  available: true,
  author: source.author,
  authorHandle: source.authorHandle,
  title: source.title,
  kind: source.kind,
  postType: source.postType,
  body: source.body,
  createdAt: source.createdAt,
  attachmentCount: 0
});

const quoteForComment = (
  post: Pick<InquiryItemContract, "id" | "kind" | "postType">,
  comment: InquiryCommentContract
): ContentQuoteContract => ({
  sourceType: "comment",
  sourceId: comment.id as string,
  sourcePostId: post.id,
  sourceRevision: 1,
  available: true,
  author: comment.author,
  authorHandle: comment.authorHandle,
  kind: post.kind,
  postType: post.postType,
  body: comment.body,
  createdAt: comment.createdAt,
  attachmentCount: 0
});

const profileName = (profiles: Map<string, ResearchProfileContract>, handle: string) =>
  profiles.get(handle)?.name ?? handle.replace(/^@/, "").replaceAll("_", " ");

const fixtureComments = ({
  community,
  postId,
  postIndex,
  createdAt,
  roster,
  profiles,
  quotedPost
}: {
  community: ResearchCommunityContract;
  postId: string;
  postIndex: number;
  createdAt: string;
  roster: string[];
  profiles: Map<string, ResearchProfileContract>;
  quotedPost?: InquiryItemContract;
}): InquiryCommentContract[] => {
  const time = Date.parse(createdAt);
  const comment = (index: number, body: string, stance: string, parentId: string | null = null): InquiryCommentContract => {
    const handle = roster[(postIndex * 7 + index * 3 + 1) % roster.length];
    const id = `${postId}-comment-${index + 1}`;
    const signaledBy = takeRotating(roster, postIndex + index + 2, 3 + ((postIndex + index) % 4));
    const forkedBy = takeRotating(roster, postIndex + index + 5, 1 + ((postIndex + index) % 3));
    const savedBy = takeRotating(roster, postIndex + index + 7, 2 + ((postIndex + index) % 3));
    return {
      id,
      parentId,
      author: profileName(profiles, handle),
      authorHandle: handle,
      stance,
      body,
      createdAt: new Date(time + (index + 1) * 11 * 60_000).toISOString(),
      metrics: {
        signal: String(signaledBy.length),
        forks: String(forkedBy.length),
        saves: String(savedBy.length),
        reads: String(28 + postIndex * 9 + index * 7)
      },
      savedBy,
      signaledBy,
      forkedBy,
      replies: []
    };
  };

  const first = comment(
    0,
    `The useful next move is to turn this into one inspectable ${community.keywords[0] ?? "community"} artifact with a named failure condition.`,
    "Constructive objection"
  );
  const firstReply = comment(
    3,
    "Agreed. I can take the first pass if someone else checks the sources and the stopping rule.",
    "Reply",
    first.id as string
  );
  const secondReply = comment(
    4,
    "I will add the counterexample packet. The current framing is still too friendly to the claim.",
    "Reply",
    first.id as string
  );
  first.replies = [firstReply, secondReply];

  const second = comment(
    1,
    "The evidence trail is strong enough to continue, but not yet strong enough to collapse the alternatives.",
    "Evidence note"
  );
  if (quotedPost) second.quote = quoteForPost(quotedPost);

  const third = comment(
    2,
    `Could this become the next working session for ${community.name}, with the failed route preserved beside the successful one?`,
    "Next step"
  );
  return [first, second, third];
};

type FixtureVariant = "paper-map" | "thought-assumption" | "proposal-pool" | "opportunity-cohort" | "paper-method" | "thought-artifact";

const variantDetails = (community: ResearchCommunityContract, variant: FixtureVariant) => {
  const field = community.field.toLowerCase();
  switch (variant) {
    case "paper-map":
      return {
        kind: "paper" as const,
        postType: "paper" as const,
        room: "library" as const,
        status: "Community field map",
        title: `${community.name}: current field map`,
        excerpt: `A public map of the claims, artifacts, and unresolved edges now shaping ${field}.`,
        body: `This field map gathers the strongest live claims in ${community.name}, the artifacts behind them, the objections that survived discussion, and the tests that would materially change direction. It is public so readers outside the community can inspect the work without needing access to the surrounding room.`
      };
    case "thought-assumption":
      return {
        kind: "thought" as const,
        postType: "thought" as const,
        room: "amphitheater" as const,
        status: "Live community question",
        title: `What would falsify our strongest ${community.keywords[0] ?? "working"} assumption?`,
        excerpt: `A sharper stopping rule for the work around ${field}.`,
        body: `The community has accumulated enough motion that its strongest assumption should now be stated in a form that can lose. Name the observation, failed replication, cost boundary, or counterexample that would make us stop defending the current route.`
      };
    case "proposal-pool":
      return {
        kind: "paper" as const,
        postType: "proposal" as const,
        room: "funding" as const,
        status: "Open",
        title: `${community.name} shared microgrant pool`,
        excerpt: `Small, fast support for inspectable work in ${field}.`,
        body: `This proposal creates a small community pool for source packets, replication attempts, instruments, field notes, and public write-ups. Each grant has a named artifact, an evidence checkpoint, and a short close-out note whether the attempt succeeds or fails.`
      };
    case "opportunity-cohort":
      return {
        kind: "thought" as const,
        postType: "opportunity" as const,
        room: "opportunities" as const,
        status: "Open",
        title: `${community.name} open build cohort`,
        excerpt: `A six-week cohort for people ready to contribute visible work to ${field}.`,
        body: `The cohort is looking for builders, readers, critics, and organizers who can carry one concrete piece of work for six weeks. Strong applications show prior artifacts, a clear reason for joining, and the ability to respond to hard feedback without turning it into theatre.`
      };
    case "paper-method":
      return {
        kind: "paper" as const,
        postType: "paper" as const,
        room: "library" as const,
        status: "Methods packet",
        title: `Methods packet for making ${field} inspectable`,
        excerpt: `A repeatable record for claims, sources, failed attempts, and changes of mind.`,
        body: `This packet is the community's working method for keeping activity legible. Every contribution records its source, the claim it bears on, the next test, the strongest objection, and what changed after review. The method is intentionally small enough to use during live work.`
      };
    case "thought-artifact":
      return {
        kind: "thought" as const,
        postType: "thought" as const,
        room: "symposium" as const,
        status: "Open thread",
        title: `The missing artifact in ${community.name}`,
        excerpt: `What this community keeps discussing but still has not made.`,
        body: `A healthy community should be able to name the artifact it is currently missing. Not another meeting and not a better slogan: a dataset, proof, instrument, field map, failed-attempt archive, opportunity brief, or paper that would let the work travel.`
      };
  }
};

export const buildCommunityContentFixtures = (
  communities: ResearchCommunityContract[],
  profileList: ResearchProfileContract[]
): InquiryItemContract[] => {
  const profiles = new Map(profileList.map((person) => [person.handle, person]));
  const variants: FixtureVariant[] = [
    "paper-map",
    "thought-assumption",
    "proposal-pool",
    "opportunity-cohort",
    "paper-method",
    "thought-artifact"
  ];

  return communities.flatMap((community, communityIndex) => {
    const roster = community.memberHandles.length ? community.memberHandles : profileList.slice(0, 12).map((person) => person.handle);
    const provisional: InquiryItemContract[] = variants.map((variant, postIndex) => {
      const details = variantDetails(community, variant);
      const handle = roster[(communityIndex * 5 + postIndex * 7) % roster.length];
      const createdAt = new Date(fixtureEpoch - (communityIndex * 7 + postIndex) * 47 * 60_000).toISOString();
      const id = `community-activity-${community.id}-${variant}`;
      const signaledBy = takeRotating(roster, communityIndex + postIndex, 8 + ((communityIndex + postIndex) % 8));
      const forkedBy = takeRotating(roster, communityIndex + postIndex + 3, 3 + ((communityIndex + postIndex) % 5));
      const savedBy = takeRotating(roster, communityIndex + postIndex + 6, 5 + ((communityIndex + postIndex) % 6));
      return {
        id,
        revision: 1,
        kind: details.kind,
        postType: details.postType,
        room: details.room,
        communityId: community.id,
        title: details.title,
        author: profileName(profiles, handle),
        authorHandle: handle,
        affiliation: community.name,
        date: "Community activity",
        createdAt,
        status: details.status,
        metrics: {
          signal: String(signaledBy.length),
          critiques: "5",
          forks: String(forkedBy.length),
          saves: String(savedBy.length),
          reads: String(420 + communityIndex * 53 + postIndex * 37)
        },
        gatheringReason: `Active work from ${community.name}.`,
        excerpt: details.excerpt,
        body: details.body,
        tags: unique([community.name.toLowerCase(), ...community.keywords.slice(0, 4), details.postType]),
        signals: [
          { label: "Community", value: community.name },
          { label: "Responses", value: "5" },
          { label: "Forks", value: String(forkedBy.length) },
          { label: "Status", value: details.status }
        ],
        claims: [details.excerpt],
        objections: ["The current evidence may still be selecting for the route the community already prefers."],
        evidence: ["Community source packets, discussion records, and linked working artifacts."],
        tests: ["Run the stated next step and publish the failure condition beside the result."],
        forks: ["Replication route", "Counterexample packet", "Public methods note"],
        comments: [],
        quote: undefined,
        saved: savedBy.includes("@udayan"),
        savedBy,
        signaledBy,
        forkedBy,
        ...(details.postType === "proposal" ? {
          patronage: {
            status: "open" as const,
            currency: "USD" as const,
            goalMinorUnits: (12_000 + communityIndex * 750) * 100,
            deadline: `2026-${String(9 + (communityIndex % 3)).padStart(2, "0")}-${String(10 + (communityIndex % 17)).padStart(2, "0")}`,
            raisedMinorUnits: (3_500 + communityIndex * 225) * 100,
            supporterCount: 3,
            topSupporters: takeRotating(roster, communityIndex + 2, 3).map((supporterHandle, index) => ({
              displayName: profileName(profiles, supporterHandle),
              amountMinorUnits: (1_400 - index * 350 + communityIndex * 20) * 100,
              anonymous: false
            }))
          }
        } : {}),
        ...(details.postType === "opportunity" ? {
          opportunity: {
            kind: communityIndex % 3 === 0 ? "fellowship" as const : communityIndex % 3 === 1 ? "collaboration" as const : "open_call" as const,
            status: "open" as const,
            location: null,
            compensation: communityIndex % 2 === 0 ? "Stipend available" : null,
            deadline: null,
            applicationCount: 4 + (communityIndex % 13)
          }
        } : {})
      } satisfies InquiryItemContract;
    });

    const paperMap = provisional[0];
    const thought = provisional[1];
    const paperMethod = provisional[4];
    provisional.forEach((item, postIndex) => {
      item.comments = fixtureComments({
        community,
        postId: item.id,
        postIndex,
        createdAt: item.createdAt as string,
        roster,
        profiles,
        quotedPost: postIndex > 0 ? paperMap : paperMethod
      });
    });

    const thoughtComment = thought.comments[0];
    paperMap.quote = communityIndex % 2 === 0
      ? quoteForPost(thought)
      : quoteForComment(thought, thoughtComment);
    thought.quote = quoteForPost(paperMethod);
    provisional[2].quote = quoteForComment(thought, thoughtComment);
    provisional[3].quote = quoteForPost(paperMap);
    paperMethod.quote = quoteForComment(thought, thought.comments[1]);
    provisional[5].quote = quoteForPost(paperMap);
    return provisional;
  });
};
