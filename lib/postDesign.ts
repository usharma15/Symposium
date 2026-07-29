import {
  bottomCaricatureIdSchema,
  paperMuseIdSchema,
  paperPostDesignAssignmentSchema,
  postDesignAssignmentSchema,
  thoughtMuseIdSchema,
  thoughtPostDesignAssignmentSchema,
  type BottomCaricatureIdContract,
  type PaperMuseIdContract,
  type PostDesignAssignmentContract,
  type PostTypeContract,
  type ThoughtMuseIdContract
} from "@/packages/contracts/src";

export const PAPER_MUSE_IDS = paperMuseIdSchema.options;
export const THOUGHT_MUSE_IDS = thoughtMuseIdSchema.options;
export const BOTTOM_CARICATURE_IDS = bottomCaricatureIdSchema.options;

export type AuthoredArtifactPostType = Extract<PostTypeContract, "paper" | "thought">;

export const postTypeHasAuthoredArtifact = (
  postType: PostTypeContract | null | undefined
): postType is AuthoredArtifactPostType =>
  postType === "paper" || postType === "thought";

export const postDesignAssignmentIsEligible = (
  postType: PostTypeContract | null | undefined,
  assignment: unknown
): assignment is PostDesignAssignmentContract =>
  postType === "paper"
    ? paperPostDesignAssignmentSchema.safeParse(assignment).success
    : postType === "thought"
      ? thoughtPostDesignAssignmentSchema.safeParse(assignment).success
      : assignment === undefined || assignment === null;

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const deterministicChoice = <Value>(values: readonly Value[], identity: string, salt: string) =>
  values[stableHash(`${identity}:${salt}:v1`) % values.length]!;

export const deterministicPostDesignAssignment = (
  postType: AuthoredArtifactPostType,
  identity: string
): PostDesignAssignmentContract => ({
  schemaVersion: 1,
  museId: postType === "paper"
    ? deterministicChoice<PaperMuseIdContract>(PAPER_MUSE_IDS, identity, "muse")
    : deterministicChoice<ThoughtMuseIdContract>(THOUGHT_MUSE_IDS, identity, "muse"),
  bottomCaricatureId: deterministicChoice<BottomCaricatureIdContract>(
    BOTTOM_CARICATURE_IDS,
    identity,
    "bottom"
  )
});

export const randomPostDesignAssignment = (
  postType: AuthoredArtifactPostType,
  chooseIndex: (exclusiveMaximum: number) => number
): PostDesignAssignmentContract => {
  const muses = postType === "paper" ? PAPER_MUSE_IDS : THOUGHT_MUSE_IDS;
  const museIndex = chooseIndex(muses.length);
  const bottomIndex = chooseIndex(BOTTOM_CARICATURE_IDS.length);
  if (
    !Number.isInteger(museIndex) ||
    !Number.isInteger(bottomIndex) ||
    museIndex < 0 ||
    museIndex >= muses.length ||
    bottomIndex < 0 ||
    bottomIndex >= BOTTOM_CARICATURE_IDS.length
  ) {
    throw new Error("Post design selection returned an out-of-bounds index.");
  }
  return postDesignAssignmentSchema.parse({
    schemaVersion: 1,
    museId: muses[museIndex],
    bottomCaricatureId: BOTTOM_CARICATURE_IDS[bottomIndex]
  });
};

export const resolvePostDesignAssignment = ({
  postType,
  assignment,
  identity
}: {
  postType: PostTypeContract | null | undefined;
  assignment: unknown;
  identity: string;
}): PostDesignAssignmentContract | undefined => {
  if (!postTypeHasAuthoredArtifact(postType)) {
    if (assignment !== undefined && assignment !== null) {
      throw new Error(`Authored-artifact assignment is not allowed for post ${identity}.`);
    }
    return undefined;
  }
  if (assignment === undefined || assignment === null) {
    return deterministicPostDesignAssignment(postType, identity);
  }
  if (!postDesignAssignmentIsEligible(postType, assignment)) {
    throw new Error(`Invalid persisted authored-artifact assignment for ${postType} post ${identity}.`);
  }
  return assignment;
};
