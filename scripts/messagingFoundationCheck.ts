import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApp } from "@/apps/api/src/server";
import { compactAttachmentFileName } from "@/lib/attachmentRules";
import type { ResearchProfile } from "@/lib/mockData";
import { emptyMessageDraftState, reduceMessageDraft } from "@/features/messages/messageDraftState";
import {
  attachmentMatchesMessageMediaKind,
  messageBodyLinks,
  messageMediaResultCount,
  rankMessagePeople
} from "@/features/messages/messageDiscoveryState";
import {
  activeConversationParticipants,
  conversationIdentityParticipant,
  currentConversationParticipant,
  messageSenderProfile,
  withoutConversationParticipant
} from "@/features/messages/messageParticipantState";
import {
  messageReadAcknowledgesSummary,
  messageReadFollowUpNeeded,
  messageReadViewportActive
} from "@/features/messages/messageReadState";
import {
  canonicalMessageFromLiveEvent,
  mergeCanonicalMessage,
  messagingEventRequiresRefresh
} from "@/features/messages/messageLiveState";
import {
  compactMessageUnreadCount,
  latestUnreadChangingEventKey,
  messagingEventCanChangeUnread
} from "@/features/messages/messageUnreadState";
import {
  conversationListQuerySchema,
  createGroupConversationInputSchema,
  deleteMessageInputSchema,
  editMessageInputSchema,
  inviteConversationParticipantsInputSchema,
  markConversationReadInputSchema,
  notificationListQuerySchema,
  saveConversationDraftInputSchema,
  sendMessageInputSchema,
  updateConversationParticipantInputSchema,
  type ConversationSummaryContract
} from "@/packages/contracts/src";

const validConversationId = "00000000-0000-4000-8000-000000000001";

const main = async () => {
  assert.equal(sendMessageInputSchema.safeParse({ recipientHandle: "@mira", body: "hello" }).success, true);
  assert.equal(sendMessageInputSchema.safeParse({ conversationId: validConversationId, attachmentIds: [validConversationId] }).success, true);
  assert.equal(sendMessageInputSchema.safeParse({ conversationId: validConversationId, recipientHandle: "@mira", body: "ambiguous" }).success, false);
  assert.equal(sendMessageInputSchema.safeParse({ body: "" }).success, false);
  assert.equal(sendMessageInputSchema.safeParse({ recipientHandle: "@mira", body: "x".repeat(8001) }).success, false);
  assert.equal(createGroupConversationInputSchema.safeParse({ title: "Lab", inviteeHandles: [] }).success, false);
  assert.equal(createGroupConversationInputSchema.safeParse({ title: "Lab", inviteeHandles: Array.from({ length: 50 }, (_, index) => `@p${index}`) }).success, false);
  assert.equal(inviteConversationParticipantsInputSchema.safeParse({ handles: ["@mira"] }).success, true);
  assert.equal(inviteConversationParticipantsInputSchema.safeParse({ handles: Array.from({ length: 50 }, (_, index) => `@p${index}`) }).success, false);
  assert.equal(conversationListQuerySchema.parse({ limit: "50" }).limit, 50);
  assert.equal(conversationListQuerySchema.safeParse({ limit: 51 }).success, false);
  assert.equal(notificationListQuerySchema.safeParse({ limit: 51 }).success, false);
  assert.equal(saveConversationDraftInputSchema.safeParse({ body: "x".repeat(8001) }).success, false);
  assert.equal(markConversationReadInputSchema.safeParse({ sequence: -1 }).success, false);
  assert.equal(updateConversationParticipantInputSchema.safeParse({ role: "owner" }).success, true);
  assert.equal(editMessageInputSchema.safeParse({ body: "revised", expectedRevision: 1 }).success, true);
  assert.equal(deleteMessageInputSchema.safeParse({ mode: "everyone" }).success, true);
  assert.equal(compactAttachmentFileName("short-name.jpg"), "short-name.jpg");
  assert.equal(compactAttachmentFileName("an-ultra-long-research-attachment-name.mp4"), "an-ultra-long-rese….mp4");
  assert.equal(compactAttachmentFileName("deep/path/to/a-ridiculously-long-script-name.py", 10), "a-ridiculo….py");

  const rankedPeople = rankMessagePeople([
    { name: "Mira Stone", handle: "@miriam" },
    { name: "Mira Sato", handle: "@mira_sato" },
    { name: "Another Mira", handle: "@another_mira" },
    { name: "Viewer", handle: "@viewer" }
  ] as ResearchProfile[], "mira", "@viewer");
  assert.deepEqual(rankedPeople.map((person) => person.handle), ["@mira_sato", "@miriam", "@another_mira"]);
  assert.deepEqual(rankMessagePeople(rankedPeople, "", "@viewer"), []);
  const documentAttachment = { id: validConversationId, kind: "pdf", fileName: "paper.pdf" } as const;
  assert.equal(attachmentMatchesMessageMediaKind(documentAttachment as never, "document"), true);
  assert.deepEqual(messageBodyLinks("Read https://example.com/paper.pdf, then https://example.com/paper.pdf."), ["https://example.com/paper.pdf"]);
  assert.equal(messageMediaResultCount([{ attachments: [documentAttachment] } as never], "document"), 1);

  const selectedDraft = reduceMessageDraft(emptyMessageDraftState, {
    type: "select",
    conversationId: validConversationId,
    localBody: null,
    serverBody: "",
    serverUpdatedAt: "2026-07-18T20:00:00.000Z"
  });
  const locallyEditedDraft = reduceMessageDraft(selectedDraft, {
    type: "edit",
    conversationId: validConversationId,
    body: "normal typing survives"
  });
  const staleProjectionDuringTyping = reduceMessageDraft(locallyEditedDraft, {
    type: "server",
    conversationId: validConversationId,
    body: "",
    preserveLocal: true,
    updatedAt: "2026-07-18T20:00:00.000Z"
  });
  assert.equal(staleProjectionDuringTyping.body, "normal typing survives");
  assert.equal(staleProjectionDuringTyping.dirty, true);
  const savedDraft = reduceMessageDraft(staleProjectionDuringTyping, {
    type: "saved",
    conversationId: validConversationId,
    body: "normal typing survives",
    updatedAt: "2026-07-18T20:00:02.000Z"
  });
  const lateOlderResponse = reduceMessageDraft(savedDraft, {
    type: "server",
    conversationId: validConversationId,
    body: "",
    preserveLocal: false,
    updatedAt: "2026-07-18T20:00:01.000Z"
  });
  assert.equal(lateOlderResponse.body, "normal typing survives");
  const newerRemoteDraft = reduceMessageDraft(lateOlderResponse, {
    type: "server",
    conversationId: validConversationId,
    body: "newer cross-device draft",
    preserveLocal: false,
    updatedAt: "2026-07-18T20:00:03.000Z"
  });
  assert.equal(newerRemoteDraft.body, "newer cross-device draft");
  assert.equal(newerRemoteDraft.dirty, false);
  const clearedForSend = reduceMessageDraft(newerRemoteDraft, {
    type: "clear",
    conversationId: validConversationId
  });
  const nextMessageWhileSending = reduceMessageDraft(clearedForSend, {
    type: "edit",
    conversationId: validConversationId,
    body: "typed while the prior message sends"
  });
  assert.equal(nextMessageWhileSending.body, "typed while the prior message sends");

  const firstLiveMessage = {
    id: "00000000-0000-4000-8000-000000000011",
    conversationId: validConversationId,
    sequence: 1,
    revision: 1,
    senderHandle: "@mira",
    body: "first",
    attachments: [],
    starred: false,
    editedAt: null,
    deletedAt: null,
    createdAt: "2026-07-18T20:00:00.000Z"
  };
  const secondLiveMessage = { ...firstLiveMessage, id: "00000000-0000-4000-8000-000000000012", sequence: 2, body: "second" };
  assert.deepEqual(mergeCanonicalMessage([secondLiveMessage], firstLiveMessage).map((message) => message.sequence), [1, 2]);
  assert.equal(mergeCanonicalMessage([{ ...firstLiveMessage, revision: 2, body: "newer" }], firstLiveMessage)[0]?.body, "newer");
  assert.equal(mergeCanonicalMessage([{ ...firstLiveMessage, starred: true }], { ...firstLiveMessage, revision: 2, body: "edited" })[0]?.starred, true);
  assert.equal(mergeCanonicalMessage([{ ...firstLiveMessage, starred: true }], { ...firstLiveMessage, revision: 2, body: "", deletedAt: "2026-07-18T20:01:00.000Z" })[0]?.starred, false);
  assert.equal(canonicalMessageFromLiveEvent({
    kind: "message.sent",
    subjectId: validConversationId,
    payload: { conversationId: validConversationId, message: firstLiveMessage }
  })?.id, firstLiveMessage.id);
  assert.equal(messagingEventRequiresRefresh({ kind: "conversation.draft.updated", subjectId: validConversationId }), false);
  assert.equal(messagingEventRequiresRefresh({ kind: "conversation.participant.updated", subjectId: validConversationId }), true);
  assert.equal(messagingEventCanChangeUnread({ kind: "message.sent", subjectId: validConversationId }), true);
  assert.equal(messagingEventCanChangeUnread({ kind: "message.edited", subjectId: validConversationId }), false);
  assert.equal(messagingEventCanChangeUnread({ kind: "conversation.read", subjectId: validConversationId }), true);
  assert.equal(compactMessageUnreadCount(7), "7");
  assert.equal(compactMessageUnreadCount(100), "99+");
  assert.equal(messageReadViewportActive({ documentVisible: true, windowFocused: true, nearLatestMessage: true }), true);
  assert.equal(messageReadViewportActive({ documentVisible: false, windowFocused: true, nearLatestMessage: true }), false);
  assert.equal(messageReadViewportActive({ documentVisible: true, windowFocused: false, nearLatestMessage: true }), false);
  assert.equal(messageReadViewportActive({ documentVisible: true, windowFocused: true, nearLatestMessage: false }), false);
  assert.equal(messageReadAcknowledgesSummary(8, 8), true);
  assert.equal(messageReadAcknowledgesSummary(9, 8), false);
  assert.equal(messageReadFollowUpNeeded({ pendingConversationId: "conversation-b", pendingSequence: 3, acknowledgedConversationId: "conversation-a", acknowledgedSequence: 100 }), true);
  assert.equal(messageReadFollowUpNeeded({ pendingConversationId: "conversation-a", pendingSequence: 101, acknowledgedConversationId: "conversation-a", acknowledgedSequence: 100 }), true);
  assert.equal(messageReadFollowUpNeeded({ pendingConversationId: "conversation-a", pendingSequence: 100, acknowledgedConversationId: "conversation-a", acknowledgedSequence: 100 }), false);
  assert.equal(messagingEventCanChangeUnread({ kind: "conversation.preferences.updated", subjectId: validConversationId }), true);
  assert.equal(messagingEventCanChangeUnread({ kind: "conversation.participant.left", subjectId: validConversationId }), true);
  assert.equal(latestUnreadChangingEventKey([
    { id: "older", kind: "message.sent", subjectId: validConversationId },
    { id: "irrelevant", kind: "conversation.draft.updated", subjectId: validConversationId },
    { id: "newer", kind: "conversation.read", subjectId: validConversationId }
  ]), "newer");

  const participants = [
    { handle: "@mira", name: "Mira", role: "member", status: "active" },
    { handle: "@lin", name: "Lin", role: "member", status: "removed" }
  ] as const;
  assert.deepEqual(activeConversationParticipants([...participants]).map((participant) => participant.handle), ["@mira"]);
  assert.equal(messageSenderProfile(firstLiveMessage, [...participants], {})?.name, "Mira");
  const liveMira = { name: "Mira Current", handle: "@mira", avatarUrl: "https://cdn.example/mira-current.webp" } as ResearchProfile;
  assert.equal(messageSenderProfile(firstLiveMessage, [...participants], { "@mira": liveMira })?.avatarUrl, liveMira.avatarUrl);
  assert.equal(currentConversationParticipant(participants[0]!, { "@mira": liveMira }).name, "Mira Current");
  const groupSummary: ConversationSummaryContract = {
    id: validConversationId,
    revision: 2,
    kind: "group",
    title: "Lab",
    role: "owner",
    status: "active",
    muted: false,
    pinned: false,
    blockedByViewer: false,
    unreadCount: 0,
    participants: [...participants],
    lastMessage: firstLiveMessage,
    draftBody: "",
    draftUpdatedAt: null,
    updatedAt: firstLiveMessage.createdAt
  };
  assert.equal(conversationIdentityParticipant(groupSummary, "@viewer", { "@mira": liveMira }), undefined);
  assert.equal(
    conversationIdentityParticipant({ ...groupSummary, kind: "direct", title: null }, "@viewer", { "@mira": liveMira })?.avatarUrl,
    liveMira.avatarUrl
  );
  assert.deepEqual(withoutConversationParticipant(groupSummary, "lin").participants.map((participant) => participant.handle), ["@mira"]);

  const repository = readFileSync("apps/api/src/repository/conversations.ts", "utf8");
  const notifications = readFileSync("apps/api/src/repository/notifications.ts", "utf8");
  const migration = readFileSync("apps/api/src/db/migrate.ts", "utf8");
  const routes = readFileSync("apps/api/src/routes/messageRoutes.ts", "utf8");
  const workspaceRoutes = readFileSync("apps/api/src/routes/workspaceRoutes.ts", "utf8");
  const server = readFileSync("apps/api/src/server.ts", "utf8");
  const attachmentRoutes = readFileSync("apps/api/src/routes/attachmentRoutes.ts", "utf8");
  const attachmentClient = readFileSync("features/attachments/attachmentUploadClient.ts", "utf8");
  const client = readFileSync("features/messages/MessagesSection.tsx", "utf8");
  const unreadButton = readFileSync("features/messages/MessagesUnreadButton.tsx", "utf8");
  const eventRoutes = readFileSync("apps/api/src/routes/eventRoutes.ts", "utf8");
  const events = readFileSync("apps/api/src/services/events.ts", "utf8");
  const styles = readFileSync("styles/89-messages.css", "utf8");
  const shell = readFileSync("components/SymposiumV0.tsx", "utf8");
  const messageAttachmentRoute = readFileSync("app/api/message-attachments/[attachmentId]/route.ts", "utf8");
  const discardAttachmentRoute = readFileSync("app/api/attachments/[attachmentId]/route.ts", "utf8");
  const profileRoute = readFileSync("app/api/profiles/route.ts", "utf8");

  assert.match(server, /registerMessageRoutes\(app\)/);
  assert.match(server, /methods: \["GET", "HEAD", "POST", "PUT"/);
  assert.doesNotMatch(workspaceRoutes, /\/v1\/(?:conversations|messages|notifications)/);
  assert.match(routes, /shared: true, scope: "message-send", limit: 60/);
  assert.match(routes, /uuidParam\(request\.params\.id\)/);
  assert.match(routes, /\/v1\/message-attachments\/:attachmentId\/access/);
  assert.match(repository, /message\.sequence > viewer\.cleared_through_sequence/);
  assert.match(repository, /viewer\.removed_through_sequence IS NULL OR message\.sequence <= viewer\.removed_through_sequence/);
  assert.match(repository, /viewer\.hidden_at IS NULL/);
  assert.match(repository, /message\.deleted_at IS NULL/);
  assert.match(repository, /assertDirectMessageAllowed/);
  assert.match(repository, /profile_blocks/);
  assert.match(repository, /hidden_at = now\(\), cleared_through_sequence/);
  assert.match(repository, /cleared_through_sequence = CASE WHEN hidden_at IS NOT NULL/);
  assert.match(repository, /status = 'removed'[\s\S]*removed_through_sequence/);
  assert.match(repository, /Date\.now\(\) - new Date\(message\.createdAt\)\.getTime\(\) > messageEditWindowMs/);
  assert.match(repository, /draft_body IS DISTINCT FROM/);
  assert.match(repository, /last_read_sequence < \$3/);
  assert.match(repository, /payload: \{ conversationId, messageId, sequence, message: value \}/);
  assert.match(repository, /message: canonicalMessage/);
  assert.match(repository, /attachment\.owner_id IS NULL AND attachment\.uploader_handle = \$2/);
  assert.doesNotMatch(repository, /createNotifications\(client, visibleRecipients/);
  assert.doesNotMatch(repository, /kind: "group_invite"/);
  assert.match(repository, /'member', 'active', now\(\)/);
  assert.match(repository, /kind: "conversation\.created"/);
  assert.match(repository, /kind: "conversation\.participants\.added"/);
  assert.match(repository, /participant\.status = 'active'/);
  assert.match(repository, /conversation\.kind = 'direct' OR participant\.hidden_at IS NULL/);
  assert.match(repository, /viewer\.muted = false/);
  assert.match(repository, /export const getMessageContext/);
  assert.match(repository, /export const leaveConversation/);
  assert.match(repository, /conversation\.ownership\.transfer/);
  assert.match(repository, /conversation\.participant\.left/);
  assert.match(repository, /attachment\.file_name ~\* '\\\\.\(txt\|md\|doc\|docx\|odt\|rtf\|pdf\)\$'/);
  assert.match(repository, /maxGroupParticipants = 50/);
  assert.match(repository, /kind: "group_removed"/);
  assert.match(notifications, /jsonb_to_recordset/);
  assert.match(notifications, /input\.kind !== "message"/);
  assert.match(notifications, /kind <> 'message'/);
  assert.match(notifications, /ON CONFLICT \(profile_handle, dedupe_key\)/);
  assert.match(migration, /0034_messaging_foundation/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS message_stars/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS message_hidden_for/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS profile_blocks/);
  assert.match(migration, /0035_message_notification_boundary/);
  assert.match(migration, /DELETE FROM notifications WHERE kind = 'message'/);
  assert.match(migration, /0036_immediate_group_membership/);
  assert.match(migration, /WHERE status = 'invited'/);
  assert.match(migration, /DELETE FROM notifications WHERE kind = 'group_invite'/);
  assert.match(client, /Math\.min\(textarea\.scrollHeight, 288\)/);
  assert.match(client, /symposium:message-draft/);
  assert.match(client, /document\.activeElement === textareaRef\.current/);
  assert.match(client, /draftSaveTimerRef/);
  assert.match(client, /conversationLoadEpochRef/);
  assert.match(client, /bodyTypedWhileSending/);
  assert.match(client, /messageReadViewportActive/);
  assert.match(client, /cloud sync pending/);
  assert.match(client, /draftState\.body \|\| draftState\.dirty/);
  assert.match(client, /liveEvent\.kind === "conversation\.draft\.updated" \|\| liveEvent\.kind === "conversation\.read"/);
  assert.match(client, /Transfer ownership/);
  assert.match(client, /Leave group/);
  assert.match(client, /messages\/\$\{messageId\}\/context/);
  assert.match(client, /mergeCanonicalMessage/);
  assert.match(client, /processedLiveEventKeySetRef/);
  assert.match(client, /setSendingCount/);
  assert.doesNotMatch(client, /if \(!selectedConversationId \|\| busy/);
  assert.match(client, /AttachmentPreviewModal/);
  assert.match(client, /pendingPreviewAttachments\(pendingAttachments\)/);
  assert.match(client, /messagePreviewAttachments\(message\.attachments, actor\.handle\)/);
  assert.match(client, /buildPostAttachmentMetadata\(file, contentType\)/);
  assert.match(client, /compactAttachmentFileName/);
  assert.doesNotMatch(client, /message-invitation-gate/);
  assert.match(client, />Add people</);
  assert.match(client, /function AddPeopleDialog/);
  assert.match(client, /className="message-inline-edit"/);
  assert.match(client, /title="Message options"/);
  assert.match(client, /className="message-info-tabs"/);
  assert.match(client, /className="message-people-tab-panel"/);
  assert.match(client, /className="message-shared-tab-panel"/);
  assert.match(client, /rankMessagePeople/);
  assert.match(client, /conversationListLoading/);
  assert.match(client, /conversationLoading/);
  assert.doesNotMatch(client, /const people = Object\.values\(profiles\)/);
  assert.match(styles, /\.message-bubble-actions\.open/);
  assert.match(client, /messageSenderProfile\(message, conversation\?\.participants/);
  assert.doesNotMatch(client, /window\.prompt/);
  assert.match(styles, /\.message-composer\.has-attachments/);
  assert.match(styles, /grid-area: previews/);
  assert.match(styles, /--messages-panel-top-clearance:\s*20px/);
  assert.match(styles, /--messages-center-bottom-clearance:\s*8px/);
  assert.match(styles, /--messages-side-controls-clearance:\s*126px/);
  assert.doesNotMatch(styles, /--messages-info-status-clearance/);
  assert.match(styles, /\.messaging-experience\.full > :is\([\s\S]*?\.messages-conversations-panel,[\s\S]*?\.messages-info-panel,[\s\S]*?\.messages-no-selection[\s\S]*?\)\s*\{[^}]*margin-top:\s*var\(--messages-panel-top-clearance\)/);
  assert.match(styles, /\.messaging-experience\.full > \.messages-conversations-panel\s*\{[^}]*height:\s*calc\(100% - var\(--messages-panel-top-clearance\) - var\(--messages-side-controls-clearance\)\)/);
  assert.match(styles, /\.messaging-experience\.full > :is\([\s\S]*?\.messages-thread-panel,[\s\S]*?\.messages-no-selection[\s\S]*?\)\s*\{[^}]*height:\s*calc\(100% - var\(--messages-panel-top-clearance\) - var\(--messages-center-bottom-clearance\)\)/);
  assert.match(styles, /\.messaging-experience\.full > \.messages-info-panel\s*\{[^}]*height:\s*calc\(100% - var\(--messages-panel-top-clearance\) - var\(--messages-side-controls-clearance\)\)/);
  assert.match(styles, /@media \(max-width:\s*960px\) and \(min-width:\s*761px\) and \(min-height:\s*761px\)[\s\S]*?\.messaging-experience\.full > :is\([\s\S]*?\.messages-thread-panel,[\s\S]*?\.messages-no-selection[\s\S]*?height:\s*calc\(100% - var\(--messages-panel-top-clearance\) - var\(--messages-side-controls-clearance\)\)/);
  assert.match(styles, /\.symposium-shell\.night :is\([\s\S]*?\.new-conversation-panel > header button,[\s\S]*?\.notifications-panel > header button[\s\S]*?color:\s*#fff8ea/);
  assert.match(styles, /\.symposium-shell\.night \.notifications-more\s*\{[^}]*color:\s*#9bdde1/);
  assert.match(client, /ownerType: "message"/);
  assert.match(client, /Open full messages/);
  assert.match(client, /IntersectionObserver/);
  assert.match(shell, /data-view=\{messagesOpen \? "messages"/);
  assert.match(shell, /onMessage=\{/);
  assert.match(shell, /notificationRevision/);
  assert.match(shell, /setMessagingEvents\(\(current\) => \[\.\.\.current, event\]\.slice\(-100\)\)/);
  assert.doesNotMatch(shell, /event\.kind === "conversation\.invited"/);
  assert.match(shell, /event\.kind === "note\.access\.granted"/);
  assert.match(routes, /\/v1\/conversations\/:id\/participants/);
  assert.match(routes, /\/v1\/conversations\/:id\/leave/);
  assert.match(routes, /\/v1\/conversations\/:id\/messages\/:messageId\/context/);
  assert.match(routes, /\/v1\/conversations\/unread/);
  assert.match(repository, /SELECT count\(\*\)::int AS "unreadCount"[\s\S]*?viewer\.hidden_at IS NULL[\s\S]*?message\.sender_handle IS DISTINCT FROM \$1/);
  assert.match(unreadButton, /\/api\/conversations\/unread/);
  assert.match(unreadButton, /latestUnreadChangingEventKey/);
  assert.match(unreadButton, /window\.addEventListener\("focus", refreshWhenActive\)/);
  assert.match(unreadButton, /window\.addEventListener\("online", refreshWhenActive\)/);
  assert.match(unreadButton, /document\.addEventListener\("visibilitychange", refreshWhenActive\)/);
  assert.match(unreadButton, /retryTimerRef\.current = window\.setTimeout/);
  assert.match(unreadButton, /aria-label=\{title\}/);
  assert.match(unreadButton, /data-unread-state=\{loadState\}/);
  assert.match(shell, /<MessagesUnreadButton/);
  assert.match(styles, /\.quick-messages-button > b\s*\{[^}]*background:\s*#197f88/);
  assert.match(messageAttachmentRoute, /record\.ownerType !== "message"/);
  assert.match(messageAttachmentRoute, /Cache-Control": "private, no-store"/);
  assert.match(attachmentRoutes, /\/v1\/attachments\/:attachmentId\/content/);
  assert.match(attachmentRoutes, /app\.delete<\{ Params: AttachmentParams \}>\("\/v1\/attachments\/:attachmentId"/);
  assert.match(attachmentRoutes, /scope: "attachment-content", limit: 30/);
  assert.match(attachmentClient, /uploadTransport === "authenticated_api"/);
  assert.match(client, /discardPendingAttachment/);
  assert.match(discardAttachmentRoute, /deleteLocalPendingAttachment/);
  assert.match(discardAttachmentRoute, /method: "DELETE"/);
  assert.match(profileRoute, /parameters\.get\("q"\)/);
  assert.match(profileRoute, /slice\(0, limit\)/);
  assert.doesNotMatch(events, /pg_notify\('symposium_live_events', id::text\)/);
  assert.match(events, /publishLocalLiveEvent\(stored\)/);
  assert.doesNotMatch(eventRoutes, /LISTEN|databaseBridge|getPool\(\)\.connect\(\)/);
  assert.match(eventRoutes, /subscribeLocalLiveEvents/);

  const app = await buildApp({ logger: false });
  try {
    const invalidMessage = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { "content-type": "application/json", "x-symposium-handle": "@boundary" },
      payload: {}
    });
    assert.equal(invalidMessage.statusCode, 400);

    const malformedConversation = await app.inject({
      method: "GET",
      url: "/v1/conversations/not-a-uuid",
      headers: { "x-symposium-handle": "@boundary" }
    });
    assert.equal(malformedConversation.statusCode, 400);

    const unreadMessages = await app.inject({
      method: "GET",
      url: "/v1/conversations/unread",
      headers: { "x-symposium-handle": "@boundary" }
    });
    assert.equal(unreadMessages.statusCode, 200);
    assert.equal(unreadMessages.json<{ unreadCount: number }>().unreadCount, 0);

    const oversizedGroup = await app.inject({
      method: "POST",
      url: "/v1/conversations/groups",
      headers: { "content-type": "application/json", "x-symposium-handle": "@boundary" },
      payload: { title: "Too large", inviteeHandles: Array.from({ length: 50 }, (_, index) => `@p${index}`) }
    });
    assert.equal(oversizedGroup.statusCode, 400);

    const validGroup = await app.inject({
      method: "POST",
      url: "/v1/conversations/groups",
      headers: { "content-type": "application/json", "x-symposium-handle": "@boundary", "idempotency-key": "group-test" },
      payload: { title: "Immediate group", inviteeHandles: ["@mira"] }
    });
    assert.equal(validGroup.statusCode, 200);
    const localConversationId = validGroup.json<{ conversationId: string }>().conversationId;
    assert.match(localConversationId, /^[0-9a-f-]{36}$/i);

    const addMember = await app.inject({
      method: "POST",
      url: `/v1/conversations/${localConversationId}/participants`,
      headers: { "content-type": "application/json", "x-symposium-handle": "@boundary" },
      payload: { handles: ["@lin"] }
    });
    assert.equal(addMember.statusCode, 200);
    assert.deepEqual(addMember.json<{ added: string[] }>().added, ["@lin"]);

    const malformedAttachmentDiscard = await app.inject({
      method: "DELETE",
      url: "/v1/attachments/not-a-uuid",
      headers: { "x-symposium-handle": "@boundary" }
    });
    assert.equal(malformedAttachmentDiscard.statusCode, 400);
  } finally {
    await app.close();
  }

  console.log("Messaging foundation checks passed.");
};

void main();
