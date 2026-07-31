import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assistantConversationListQuerySchema,
  assistantMessageInputSchema,
  assistantProjectDeleteResultSchema,
  assistantProjectListResultSchema,
  assistantProjectMutationResultSchema,
  assistantThreadUpdateInputSchema,
  createAssistantProjectInputSchema,
  deleteAssistantProjectInputSchema,
  updateAssistantProjectInputSchema
} from "@/packages/contracts/src";
import { nextAssistantProjectSelection } from "@/features/assistant/assistantControllerModel";

const projectId = "41b805db-3ed3-4a2a-a20d-6b75b52166db";
const conversationId = "bec08981-7b08-41c8-a045-0b671d8b1320";
const now = "2026-07-26T20:00:00.000Z";

assert.equal(nextAssistantProjectSelection(null, projectId), projectId);
assert.equal(nextAssistantProjectSelection(projectId, projectId), null);
assert.equal(
  nextAssistantProjectSelection(
    projectId,
    "7a5bb3b8-d1dd-4d22-a9c5-d1908e346950"
  ),
  "7a5bb3b8-d1dd-4d22-a9c5-d1908e346950"
);

assert.deepEqual(
  createAssistantProjectInputSchema.parse({ name: "  Quantum methods  " }),
  { name: "Quantum methods" }
);
assert.equal(
  createAssistantProjectInputSchema.safeParse({ name: " " }).success,
  false
);
assert.equal(
  createAssistantProjectInputSchema.safeParse({
    name: "x".repeat(121)
  }).success,
  false
);
assert.equal(
  updateAssistantProjectInputSchema.safeParse({
    name: "Renamed",
    expectedRevision: 2
  }).success,
  true
);
assert.equal(
  updateAssistantProjectInputSchema.safeParse({
    name: "Renamed",
    expectedRevision: 0
  }).success,
  false
);
assert.equal(
  deleteAssistantProjectInputSchema.safeParse({
    expectedRevision: 1
  }).success,
  true
);
assert.equal(
  assistantConversationListQuerySchema.safeParse({
    projectId,
    status: "active"
  }).success,
  true
);
assert.equal(
  assistantThreadUpdateInputSchema.safeParse({
    projectId,
    expectedRevision: 1
  }).success,
  true
);
assert.equal(
  assistantThreadUpdateInputSchema.safeParse({
    projectId: null,
    expectedRevision: 1
  }).success,
  true
);
assert.equal(
  assistantMessageInputSchema.safeParse({
    conversationId,
    projectId,
    message: "This must not move an existing chat implicitly."
  }).success,
  false
);

const project = {
  id: projectId,
  name: "Quantum methods",
  revision: 1,
  activeThreadCount: 0,
  createdAt: now,
  updatedAt: now
};
assert.equal(
  assistantProjectListResultSchema.safeParse({ projects: [project] }).success,
  true
);
assert.equal(
  assistantProjectMutationResultSchema.safeParse({ project }).success,
  true
);
assert.deepEqual(
  assistantProjectDeleteResultSchema.parse({
    projectId,
    deleted: true,
    unfiledConversationCount: 250_000
  }),
  {
    projectId,
    deleted: true,
    unfiledConversationCount: 250_000
  }
);

const migration = readFileSync("apps/api/src/db/migrate.ts", "utf8");
const projectMigration = migration.slice(
  migration.indexOf('id: "0063_assistant_chat_projects"')
);
assert.match(projectMigration, /CREATE TABLE IF NOT EXISTS ai_projects/);
assert.match(
  projectMigration,
  /owner_handle TEXT NOT NULL REFERENCES profiles\(handle\) ON DELETE CASCADE/
);
assert.match(
  projectMigration,
  /UNIQUE INDEX IF NOT EXISTS ai_projects_owner_name_unique_idx/
);
assert.match(
  projectMigration,
  /ADD COLUMN IF NOT EXISTS project_id UUID[\s\S]*ON DELETE SET NULL/
);
assert.match(
  projectMigration,
  /enforce_ai_conversation_project_owner[\s\S]*project\.owner_handle = NEW\.owner_handle[\s\S]*project\.deleted_at IS NULL/
);
assert.doesNotMatch(
  projectMigration,
  /\b(?:context|memory|instruction|embedding|summary|source)_?(?:text|json|id|data)?\s+(?:TEXT|JSONB|UUID|VECTOR)/i
);

const repository = readFileSync(
  "apps/api/src/repository/assistantProjects.ts",
  "utf8"
);
assert.match(repository, /project\.owner_handle = \$1/);
assert.match(repository, /project\.deleted_at IS NULL/);
assert.match(repository, /LIMIT 100/);
assert.match(repository, /pg_advisory_xact_lock/);
assert.match(repository, /A Project with that name already exists/);
assert.match(
  repository,
  /project\.revision = \$4[\s\S]*project\.deleted_at IS NULL/
);
assert.match(
  repository,
  /WITH unfiled AS \([\s\S]*SET project_id = NULL,[\s\S]*metadata_revision = metadata_revision \+ 1/
);
assert.doesNotMatch(repository, /DELETE FROM ai_conversations/i);
assert.doesNotMatch(repository, /SELECT id::text[\s\S]*FROM ai_conversations/);
assert.doesNotMatch(repository, /unfiledConversationIds,\s*deletedChats/);
assert.match(repository, /unfiledConversationCount/);
assert.match(repository, /assistant\.project\.(?:create|update|delete)/);
assert.match(repository, /contextBehavior: "organization_only"/);
assert.match(repository, /claimMutation/);
assert.match(repository, /completeMutation/);

const assistantRepository = readFileSync(
  "apps/api/src/repository/assistant.ts",
  "utf8"
);
assert.match(
  assistantRepository,
  /FROM ai_projects[\s\S]*id = \$\d+[\s\S]*owner_handle = \$\d+[\s\S]*deleted_at IS NULL[\s\S]*FOR SHARE/
);
assert.match(
  assistantRepository,
  /conversation\.project_id = \$\$\{values\.length\}[\s\S]*project\.owner_handle = \$1[\s\S]*project\.deleted_at IS NULL/
);
assert.match(assistantRepository, /INSERT INTO ai_conversations \([\s\S]*project_id/);

const provider = readFileSync(
  "apps/api/src/services/openaiResponses.ts",
  "utf8"
);
assert.doesNotMatch(provider, /\bprojectId\b|\bProject name\b|PROJECT CONTEXT/);

const routes = readFileSync(
  "apps/api/src/routes/workspaceRoutes.ts",
  "utf8"
);
for (const method of ["get", "post", "patch", "delete"]) {
  assert.match(routes, new RegExp(`app\\.${method}[\\s\\S]*assistant/projects`));
}
assert.match(
  routes,
  /assistant\/projects[\s\S]*withWriteActor\(request, \{[\s\S]*scope: "assistant-action"/
);

const nextListRoute = readFileSync(
  "app/api/assistant/[[...segments]]/route.ts",
  "utf8"
);
const nextMutationRoute = readFileSync(
  "lib/assistantRouteSupport.ts",
  "utf8"
);
for (const route of [nextListRoute, nextMutationRoute]) {
  assert.match(route, /assistantCompatibilityRoute|require the live backend|status: 503/i);
  assert.doesNotMatch(route, /mock|local fallback|localStorage/i);
}

const experience = readFileSync(
  "features/assistant/AssistantExperience.tsx",
  "utf8"
);
assert.match(experience, />\s*All\s*</);
assert.match(experience, />\s*Projects\s*</);
assert.match(experience, /aria-label="Archived chats"/);
assert.match(experience, /<Archive size=\{14\} \/>/);
assert.match(
  experience,
  /nextAssistantProjectSelection\(selectedProjectId, projectId\)/
);
assert.match(
  experience,
  /expandedContent=\{renderThreadList\(true\)\}/
);
assert.match(
  experience,
  /threadLibraryView === "projects" \? null : renderThreadList\(\)/
);
assert.doesNotMatch(experience, /assistant-project-thread-heading/);

const projectPanel = readFileSync(
  "features/assistant/AssistantProjectsPanel.tsx",
  "utf8"
);
assert.match(
  projectPanel,
  /Organization only\. Projects never add context or consume AI answers\./
);
assert.match(
  projectPanel,
  /Its chats return to All\. No chat, source, or Office[\s\S]*document is deleted\./
);
assert.match(
  projectPanel,
  /mode\.kind === "delete"[\s\S]*\? "alertdialog"/
);
assert.match(projectPanel, /aria-label="Create a Project"/);
assert.match(projectPanel, /<ChevronRight/);
assert.match(
  projectPanel,
  /aria-expanded=\{project\.id === selectedProjectId\}/
);
assert.match(
  projectPanel,
  /project\.id === selectedProjectId[\s\S]*assistant-project-chats[\s\S]*expandedContent/
);

const assistantStyles = readFileSync("styles/92-ai-tablet.css", "utf8");
const projectsPanelStyleStart = assistantStyles.indexOf(
  ".assistant-projects-panel {"
);
const projectsPanelStyles = assistantStyles.slice(
  projectsPanelStyleStart,
  assistantStyles.indexOf(".assistant-thread-list {", projectsPanelStyleStart)
);
assert.match(
  projectsPanelStyles,
  /\.assistant-projects-panel \{[\s\S]*display: flex;[\s\S]*flex: 1 1 auto;[\s\S]*flex-direction: column;[\s\S]*overflow: hidden;/
);
assert.match(
  projectsPanelStyles,
  /\.assistant-project-list \{[\s\S]*flex: 1 1 auto;[\s\S]*align-content: start;[\s\S]*overflow-y: auto;/
);
assert.match(
  projectsPanelStyles,
  /\.assistant-thread-list\.assistant-project-thread-list \{[\s\S]*overflow: visible;/
);
assert.doesNotMatch(projectsPanelStyles, /max-height:/);

const controller = readFileSync(
  "features/assistant/useAssistantController.ts",
  "utf8"
);
assert.match(controller, /subjectType: "thread" \| "project"/);
assert.match(controller, /refreshProjects/);
assert.match(controller, /projectId: submissionProjectId/);
assert.match(
  controller,
  /threadLibraryViewRef\.current === "projects"[\s\S]*selectedProjectIdRef\.current = null;[\s\S]*projectId: null/
);
assert.doesNotMatch(
  controller,
  /(?:prompt|context|source|instruction|memory)[A-Za-z]*\s*[:=][^\n]*project/i
);

console.log("assistant project checks passed");
