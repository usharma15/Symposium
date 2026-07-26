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

### 2. Inspectable evidence and scoped reading — Context Dock foundation shipped

- Show the exact source set used for each answer. **Shipped.**
- Let users include or exclude attached sources before asking. **Shipped, bounded to five included snapshots.**
- Capture and revisit saved source revisions through the Context Dock. **Shipped.**
- Add source-specific reading tools for posts, comments, notes, workspace documents, attachments, messages, and the visible selection.
- Make answer claims link back to the relevant Symposium passage or attachment location.
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
- Do not invent Projects, folders, long-term memory, automatic actions, or unbounded history before those systems have real persistence and product rules.

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

- Let a user highlight a passage and insert a linked citation marker into a post, comment, or Office document.
- Store a durable source snapshot and precise locator rather than only formatted text.
- Render hover previews containing the quoted passage and source metadata.
- Generate and update APA, MLA, and Chicago bibliographies from the structured citation records.
- Use AI for metadata recovery and formatting assistance, but keep deterministic citation records and rendering as the foundation.

### 6. Permissioned site-wide actions

- Introduce a server-owned tool registry with strict input schemas and per-tool authorization.
- Start with reversible drafts and organization:
  - create or edit a private note draft;
  - create a message draft;
  - create a post draft;
  - file or organize Office material;
  - save or attach research sources.
- Require an editable preview and explicit confirmation for messages, publications, permission changes, deletion, and other consequential actions.
- Return structured action receipts and place them in the thread timeline only after the server confirms success.

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
