export const verificationCategories = [
  "architecture-design-security",
  "state-sync",
  "content-storage",
  "collaboration",
  "assistant",
  "product",
  "typecheck",
  "build"
] as const;

export type VerificationCategory = typeof verificationCategories[number];
export type VerificationStage = {
  id: string;
  script: string;
  category: VerificationCategory;
};

const stage = (script: string, category: VerificationCategory): VerificationStage => ({
  id: script,
  script,
  category
});

export const verificationManifest = [
  stage("architecture:check", "architecture-design-security"),
  stage("platform:check", "architecture-design-security"),
  stage("styles:check", "architecture-design-security"),
  stage("post-tone:check", "architecture-design-security"),
  stage("post-semantics:check", "architecture-design-security"),
  stage("post-design:check", "architecture-design-security"),
  stage("authored-artifacts:check", "architecture-design-security"),
  stage("historical-world:check", "architecture-design-security"),
  stage("security:check", "architecture-design-security"),
  stage("infrastructure:check", "architecture-design-security"),
  stage("provider-cost:check", "architecture-design-security"),
  stage("bounded-read:check", "architecture-design-security"),
  stage("routing:check", "architecture-design-security"),
  stage("entities:check", "state-sync"),
  stage("entity-revision:check", "state-sync"),
  stage("follow-reconciliation:check", "state-sync"),
  stage("api-client:check", "state-sync"),
  stage("live-transport:check", "state-sync"),
  stage("core:check", "state-sync"),
  stage("action:check", "state-sync"),
  stage("action-state:check", "state-sync"),
  stage("reconciliation:check", "state-sync"),
  stage("identity:check", "state-sync"),
  stage("item-mutation:check", "state-sync"),
  stage("cross-tab:check", "state-sync"),
  stage("attachment:check", "content-storage"),
  stage("attachment-preview:check", "content-storage"),
  stage("comment-attachment:check", "content-storage"),
  stage("community:check", "content-storage"),
  stage("document-editor:check", "content-storage"),
  stage("citation:check", "content-storage"),
  stage("quote:check", "content-storage"),
  stage("storage-deletion:check", "content-storage"),
  stage("mutation:check", "content-storage"),
  stage("messaging:check", "collaboration"),
  stage("notifications:check", "collaboration"),
  stage("content-analytics:check", "collaboration"),
  stage("note-revision:check", "collaboration"),
  stage("workspace:check", "collaboration"),
  stage("workspace-collaboration:check", "collaboration"),
  stage("scribble:check", "collaboration"),
  stage("assistant:check", "assistant"),
  stage("assistant-project:check", "assistant"),
  stage("assistant-action:check", "assistant"),
  stage("assistant-post-draft:check", "assistant"),
  stage("assistant-draft-studio:check", "assistant"),
  stage("assistant-provider:check", "assistant"),
  stage("assistant-evidence:check", "assistant"),
  stage("assistant-vision:check", "assistant"),
  stage("patronage:check", "product"),
  stage("opportunity:check", "product"),
  stage("profile:check", "product"),
  stage("post-publishing:check", "product"),
  stage("entry-session:check", "product"),
  stage("typecheck:all", "typecheck"),
  stage("build", "build")
] as const satisfies readonly VerificationStage[];
