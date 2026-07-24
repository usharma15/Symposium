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

### 3. Whole-content translation — structured post/comment and page translation shipped; whole-document action remains

- Translate an entire post or individual comment on request while keeping the original one click away. **Shipped.**
- Cache post/comment translations by canonical source revision and target language. **Shipped.**
- Keep unsupported-language input and cached reuse at zero AI answers. **Shipped.**
- Translate supported document attachments through the document viewer. **Shipped for one user-selected PDF, DOCX, or extracted legacy/text-document page at a time.**
- Keep PDF and DOCX documents continuously scrollable, with the visible reading position selecting the active translation page. **Shipped.**
- Share the active page, exact normalized reading position, saved page translations, and Original/Translation choice across feed preview, viewing window, and fullscreen. **Shipped.**
- Preserve rich post/comment document structure and translate text in place without replacing equations, code, citations, drawings, or inline attachments. **Shipped.**
- Render Translation as a parallel reconstructed page rather than a text box over the source: text PDFs use deterministic source geometry, scanned pages use bounded visual regions plus preserved equation/figure crops, DOCX uses a translated structural clone, and text/Markdown documents retain their original whitespace model. **Shipped.**
- Keep Original completely untouched and make the reconstructed Translation page independently selectable while retaining diagrams, images, equations, rules, columns, headings, and other non-text page content. **Shipped.**
- Add one action for a bounded whole discussion and a bounded whole-document translation job. **Remaining.**
- Preserve headings, structure, citations, quantities, uncertainty, and scientific terminology. **Enforced through structured segments and provider-output identity checks.**
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
- “Update view” now creates a preserved source revision; the product still needs a longer-term archival policy beyond the current bounded revision history.
- Which read permissions can become standing per-user preferences.
- Which reversible draft actions can eventually run without confirmation.
- The exact citation-style edition policy and CSL-compatible rendering layer.
