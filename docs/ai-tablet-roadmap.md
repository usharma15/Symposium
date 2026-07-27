# Symposium AI Tablet roadmap

## Product direction

The AI Tablet is becoming a site-wide research assistant, not a disposable chat box. It should understand the user’s chosen Symposium context, preserve research continuity, make its evidence inspectable, and take site actions only through explicit, permissioned product tools.

Symposium remains the system of record. Conversation history, attached sources, permissions, drafts, and completed actions are stored and authorized by Symposium rather than left to the model provider.

## Non-negotiable behavior

- A route change never silently replaces a thread’s active context.
- The user can see which view is active, attach another view as a source, or deliberately switch the active view.
- Model text is evidence, never authority to execute an action.
- Generated content and persisted content are separate. The assistant cannot claim an action succeeded until Symposium confirms it.
- Any meaningful write is previewable, attributable, idempotent, and auditable.
- Context and history are bounded so that a long thread cannot create unbounded model cost.
- Image sources are resized, rate-limited, and included in the same pre-request cost reservation as text.
- Translations preserve the original and are user-requested, not automatically substituted site-wide.

## Build order

### 1. Research Threads and context history — shipped

- Persist named thread history across Tablet openings.
- Resume the most relevant recent thread for the current view.
- Store a bounded set of user-chosen source snapshots per thread.
- Show an explicit “View changed” state with:
  - **Use this view** — attach it and make it active.
  - **Add as source** — attach it without changing the active view.
- Record context changes in the visible thread timeline.
- Protect source mutations with revision checks so two sessions cannot silently overwrite one another.
- Keep internal document/content translation jobs out of the user’s Research Thread history.
- Preserve an immutable origin snapshot and explicit source revisions instead of overwriting an earlier snapshot.

### 2. Inspectable evidence and scoped reading — shipped for current source surfaces

- Show the exact source set used for each answer. **Shipped.**
- Let users include or exclude attached sources before asking. **Shipped, bounded to five included snapshots.**
- Capture and revisit saved source revisions through the Context Dock. **Shipped.**
- Split posts, comments, notes/workspace documents, attachments, messages, and the visible selection into bounded stable evidence passages before the provider request. **Shipped.**
- Require the model to classify material source-dependent claims as direct evidence, inference, or insufficient context and cite only server-supplied passage references. Reject invented passage references instead of persisting them. **Shipped.**
- Persist claim-level evidence maps with exact saved excerpts and canonical deep links to posts, comments, notes, messages, attachments, and available page numbers. **Shipped.**
- Recheck current access to private posts/comments, notes, conversations, and attachments before spending an answer; fail closed after deletion or revocation and label a saved revision when the underlying entity has changed. **Shipped.**
- Keep old answers reloadable: their saved source set remains visible even when they predate claim-level evidence maps. **Shipped.**
- Accept private AI chat attachments up to 5 MB with durable ownership, transcript and Context Dock persistence, protected retrieval, bounded extracted-text grounding, and deletion with the parent chat. **Shipped.**
- Inspect at most two included PNG, JPEG, or WebP sources per answer through a server-normalized 1600px vision input. Reserve the full image-token ceiling before the provider call, enforce assistant-specific upload and daily vision limits, and never silently resend excluded images. **Shipped.**
- Keep videos, unsupported image formats, scans, and unselected PDF pages stored but outside model vision unless a later bounded workflow explicitly includes them.

### 3. Full AI Workspace shell — shipped

- Expand the compact AI Tablet into a dedicated three-column research workspace without creating a second conversation or assistant state owner.
- Keep Research Threads and bounded recent-thread search on the left, the active transcript and composer in the center, and the full-height Context Dock on the right.
- Preserve the mounted conversation surface, unsent per-thread drafts, Quick Note cards, and transcript position while moving between compact Tablet and full Workspace modes.
- Give the workspace canonical `/assistant` and `/assistant/threads/:threadId` routes with Back, Forward, direct-load, and saved-thread reload behavior.
- Keep opening, browsing, searching, arranging context, and switching panes at zero AI-answer cost; do not fetch assistant state while both surfaces are closed.
- Refresh the selected thread across tabs and focused sessions, retain retry identities after failed writes, and reload revision-conflicted context before asking the user to try again.
- Reset all assistant-owned state when the authenticated Symposium identity changes.
- Adapt the three columns to explicit Threads, Chat, and Context panes on narrow screens without horizontal page overflow.
- Keep the left conversation library manageable with durable rename, pin, archive, restore, and privacy-preserving delete controls. **Shipped.**
- Search titles and user/assistant message bodies on the server, paginate with stable cursors, and keep pinned chats ahead of otherwise last-chatted ordering. **Shipped.**
- Synchronize conversation-library mutations through live events and same-browser broadcasts, with revision conflicts reloaded before retry. **Shipped.**
- Preserve the AI usage ledger when a chat is deleted while removing its transcript, context snapshots, and completed mutation receipts; discard rather than persist an answer that finishes after deletion. **Shipped.**
- Keep Projects strictly as private chat organization: each active chat can be
  in at most one Project, All still shows every active chat, and Archive remains
  a separate compact view. **Shipped.**
- Match the Office notebook navigator: Project rows expand and collapse inline
  to reveal their active chats, with one shared scrolling rail instead of
  separate Project and chat scroll regions. **Shipped.**
- Creating, renaming, selecting, filing, unfiling, and deleting Projects does
  not call the model or consume an AI answer. Project names and membership are
  never added to prompts, sources, memory, summaries, embeddings, or
  instructions. **Shipped.**
- Deleting a Project returns its chats to All and never deletes chats, source
  snapshots, attachments, or Office documents. Project mutations are
  owner-authorized, revision-checked, replay-safe, audited, and synchronized
  across open sessions. **Shipped.**
- Long-term memory, project-wide context intelligence, automatic actions, and
  unbounded history remain intentionally out of scope.

### 4. Whole-content translation — agreed milestone shipped; whole-document action deferred

- Translate an entire post or individual comment on request while keeping the original one click away. **Shipped.**
- Cache post/comment translations by canonical source revision and target language. **Shipped.**
- Keep unsupported-language input and cached reuse at zero AI answers. **Shipped.**
- Translate supported document attachments through the document viewer. **Shipped for one user-selected PDF, DOCX, or extracted legacy/text-document page at a time.**
- Keep PDF and DOCX documents continuously scrollable, with the visible reading position selecting the active translation page. **Shipped.**
- Share the active page, exact normalized reading position, saved page translations, and Original/Translation choice across feed preview, viewing window, and fullscreen. **Shipped.**
- Preserve rich post/comment document structure and translate text in place without replacing equations, code, citations, drawings, or inline attachments. **Shipped.**
- Render Translation as a parallel reconstructed page rather than a text box over the source: text PDFs use deterministic source geometry, scanned pages use bounded visual regions plus preserved equation/figure crops, DOCX uses a translated structural clone, and text/Markdown documents retain their original whitespace model. **Shipped.**
- Keep Original completely untouched and make the reconstructed Translation page independently selectable while retaining diagrams, images, equations, rules, columns, headings, and other non-text page content. **Shipped.**
- A bounded whole-discussion or whole-document translation job is intentionally deferred until the product has a larger dedicated AI budget. It is not part of the current AI Tablet sequence.
- Preserve headings, structure, citations, quantities, uncertainty, and scientific terminology. **Enforced through structured segments and provider-output identity checks.**
- Cache translations by source revision, target language, and translation policy.

### 5. Real in-app citations

- Highlighted post/comment passages, attachment captures, and eligible AI Evidence Map records can be staged once and inserted at the active caret in a post, comment, or Office document. **Shipped.**
- Inline markers are structured document atoms with a stable citation ID, exact excerpt and locator, server-canonical source metadata, source revision, and server capture time. New citations are re-authorized against the source on save; saved snapshots cannot be silently mutated. **Shipped.**
- Linked numeric markers, keyboard-accessible hover/focus previews, stable first-occurrence ordering, and automatic References sections render anywhere the shared document renderer is used. **Shipped.**
- APA, MLA, and Chicago presentation choices are stored in document settings and rendered deterministically from the structured records. The exact edition policy and a future CSL-compatible formatter remain intentionally open. **Shipped within that explicit boundary.**
- Post, comment, and Office create/update paths persist the canonical records in their existing revisioned `content_document`; audit metadata records total and newly captured citation counts. Existing snapshots remain editable if source access later changes. **Shipped.**
- Public and community publication paths enforce citation audience containment: public destinations accept only public sources, while private-community destinations accept public sources or private sources from that same community. Private Office drafts remain available only to the authorized actor until publication revalidates every citation against the destination audience. **Shipped.**
- Office draft discussions receive the same server canonicalization as post/comment documents, and publishing a prepared discussion re-authorizes its citations against the resulting public or community item. **Shipped.**
- Translation excludes native citation atoms from provider input and restores them byte-for-byte in reconstructed documents; Scribble rejects injected native markers that have not passed the canonical document save path. **Shipped.**
- Whole-file and image locators are server-derived. PDF page, spreadsheet range, and presentation slide locators are accepted only when the exact excerpt appears in the named bounded preview region; PDF pages outside the stored bounded extraction remain intentionally unsupported rather than weakly verified. **Shipped within that explicit boundary.**
- Native citation contracts, TipTap round trips, authorization/canonicalization, audience containment, exact locator validation, immutable snapshots, Evidence Map classification, translation preservation, accessibility integration, responsive styling, full typechecks, and the complete repository production-build gate are covered by `npm run citation:check` and `npm run verify`. **Verified locally on 2026-07-26.**
- AI metadata recovery and formatting assistance are deferred until incomplete legacy/external metadata actually requires them; AI-generated prose is not accepted as citation truth.

### 6. Permissioned site-wide actions

- Introduce a server-owned tool registry with strict input schemas and per-tool authorization. **Foundation shipped:** the registry exposes `office.note.create_draft`, `office.post.create_draft`, and the chat-bound `office.document.edit_draft`; unsupported model tools fail closed, model output can propose but cannot execute an action outside the active permission mode, and each confirmation endpoint verifies the server-persisted proposal tool before doing any work.
- Start with reversible drafts and organization:
  - create or edit a private note draft; **private note creation and revision-safe Draft Studio editing shipped**;
  - create a message draft;
  - create a post draft; **private Thought/Paper creation shipped**;
  - file or organize Office material;
  - save or attach research sources.
- The private-note slice provides an editable title and body, an owner-authorized notebook destination, explicit confirmation, live-database-only execution, mutation-ledger and persistent-receipt replay safety, source/action audit metadata, source-reference preservation, and private note plus Assistant live events. **Shipped.**
- The private-post slice adds an editable Thought/Paper type without exposing publication: confirmation creates a private Office document whose kind and publication target are exactly the confirmed type, while proposal, opportunity, target, attachments, public-post creation, and public events remain absent. A deterministic latest-request gate rejects action output inferred from sources, quotations, prior turns, publication-only requests, or ordinary summarization. **Shipped.**
- A confirmed Assistant-created note, Thought, or Paper now opens as the same canonical Office document inside Draft Studio. Direct edits autosave through the existing expected-revision path; cross-tab/live refreshes apply only to a clean editor and preserve unsaved work on conflict. **Shipped.**
- Continued chat can propose bounded title, block-replacement, paragraph-insertion, or block-deletion operations against the exact current revision. The server re-authorizes the owner, conversation, original creation receipt, private draft lifecycle, revision, and every target block before applying anything. Native-citation blocks, references, attachments, equations, drawings, lists, code, publication state, access, and attachment ownership are protected. **Shipped.**
- Review is the default AI-edit mode. A visible session toggle can grant Live editing for this one private draft; only deterministic latest-request edit intent can use it. Both modes create immutable revision checkpoints, private live events, action receipts, and audit records. Undo restores the exact pre-AI snapshot as a new monotonic revision and fails closed if any later edit has occurred. **Shipped.**
- Require an editable preview and explicit confirmation for messages, publications, permission changes, deletion, and other consequential actions. The private-note and private-post slices both require confirmation so the product can validate the complete permission flow before introducing any standing draft permission. **Shipped for private note and Thought/Paper creation.**
- Return structured action receipts and place them in the thread timeline only after the server confirms success. **Shipped for private note/Thought/Paper creation, reviewed and live draft revisions, and revision-safe undo.**
- Sending, publishing, sharing, access changes, deletion, autonomous/background execution, and every unregistered action remain unavailable by design.
- Canonical internal routes are now supplied as explicit bounded evidence passages, so route questions no longer force the model to infer a URL from descriptive page copy. Protocol-relative or malformed routes fail closed. **Shipped.**
- Contracts, provider output restrictions, explicit-intent gating, tool/endpoint isolation, ownership/thread/notebook authorization, private lifecycle, replay behavior, protected-block preservation, review/live permission, monotonic undo, audit/events, source preservation, persistent timeline receipts, accessibility copy, cross-tab refresh, complete typechecks, and the production build are covered by `npm run assistant-action:check`, `npm run assistant-post-draft:check`, `npm run assistant-draft-studio:check`, `npm run assistant-evidence:check`, and `npm run verify`. **Private-note slice verified locally on 2026-07-26; Thought/Paper and Draft Studio slices passed the complete local release gate on 2026-07-27, and the Assistant shell passed desktop, narrow, compact, day, and night browser acceptance.**

## Permission model

| Level | Examples | Confirmation |
| --- | --- | --- |
| Read | Current view, user-selected thread history, selected notes or chats | Granted by explicit source selection or a narrow standing preference |
| Draft | Note draft, post draft, message draft, organization proposal | Preview before persistence; reversible drafts may later support a user-configured standing permission |
| Act | Send, publish, invite, share, change access, delete | Always show the exact action and require explicit confirmation |

Broad access should be composed from narrow capabilities. “Access my workspace” is not one permission; reading a selected notebook, creating a draft, filing a note, and sharing a document are separate powers.

## Acceptance gates

A phase is complete only when it has:

- durable database persistence;
- authenticated ownership and authorization checks;
- synchronization or conflict behavior across already-open sessions;
- retry-safe mutations;
- source and action audit records;
- focused contract checks and full repository verification;
- fresh deployed browser evidence for the user-visible workflow.

## Decisions intentionally left open

- Chats receive an automatic initial title and can now be renamed manually; richer automatic retitling remains optional.
- “Update view” now creates a preserved source revision; the product still needs a longer-term archival policy beyond the current bounded revision history.
- Which read permissions can become standing per-user preferences.
- Which reversible draft actions can eventually run without confirmation.
- The exact citation-style edition policy and CSL-compatible rendering layer.
