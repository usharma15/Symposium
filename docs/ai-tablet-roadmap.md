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
- Translations preserve the original and are user-requested, not automatically substituted site-wide.

## Build order

### 1. Research Threads and context history — building now

- Persist named thread history across Tablet openings.
- Resume the most relevant recent thread for the current view.
- Store a bounded set of user-chosen source snapshots per thread.
- Show an explicit “View changed” state with:
  - **Use this view** — attach it and make it active.
  - **Add as source** — attach it without changing the active view.
- Record context changes in the visible thread timeline.
- Protect source mutations with revision checks so two sessions cannot silently overwrite one another.

### 2. Inspectable evidence and scoped reading

- Show the exact source set used for each answer.
- Let users include or exclude attached sources before asking.
- Add source-specific reading tools for posts, comments, notes, workspace documents, attachments, messages, and the visible selection.
- Make answer claims link back to the relevant Symposium passage or attachment location.

### 3. Whole-content translation

- Move translation out of the cramped current preview control.
- Translate an entire post and its comments on request while keeping the original one click away.
- Translate supported document attachments through the document viewer.
- Preserve headings, structure, citations, quantities, uncertainty, and scientific terminology.
- Cache translations by source revision, target language, and translation policy.

### 4. Real in-app citations

- Let a user highlight a passage and insert a linked citation marker into a post, comment, or Office document.
- Store a durable source snapshot and precise locator rather than only formatted text.
- Render hover previews containing the quoted passage and source metadata.
- Generate and update APA, MLA, and Chicago bibliographies from the structured citation records.
- Use AI for metadata recovery and formatting assistance, but keep deterministic citation records and rendering as the foundation.

### 5. Permissioned site-wide actions

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

- Whether a thread is manually named, automatically titled, or both.
- Whether “Update view” replaces an existing source snapshot or creates a source revision visible in the timeline.
- Which read permissions can become standing per-user preferences.
- Which reversible draft actions can eventually run without confirmation.
- The exact citation-style edition policy and CSL-compatible rendering layer.
