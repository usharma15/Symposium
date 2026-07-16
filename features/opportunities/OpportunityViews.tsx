"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft, BriefcaseBusiness, CalendarDays, Check, ChevronLeft, ChevronRight,
  ExternalLink, FileText, Link2, MapPin, MessageCircle, Paperclip, Star, Trash2, X
} from "lucide-react";
import type { InquiryAttachment, InquiryItem } from "@/lib/mockData";
import type {
  OpportunityApplicationContract,
  OpportunityKindContract,
  OpportunityPostInputContract
} from "@/packages/contracts/src";
import { AttachmentPreviewModal } from "@/features/attachments/AttachmentPreviewModal";
import type { AttachmentUploadHandler } from "@/features/attachments/AttachmentViews";
import { createClientMutationId, symposiumApi } from "@/features/api/symposiumApiClient";
import { canonicalRouteHref } from "@/features/navigation/canonicalRoute";

export type OpportunityDraftFields = {
  kind: OpportunityKindContract;
  status: "open" | "closed";
  location: string;
  compensation: string;
  deadline: string;
};

export const emptyOpportunityDraftFields = (): OpportunityDraftFields => ({
  kind: "collaboration", status: "open", location: "", compensation: "", deadline: ""
});

export const opportunityDraftFieldsForPost = (value: OpportunityPostInputContract): OpportunityDraftFields => ({
  kind: value.kind, status: value.status, location: value.location ?? "",
  compensation: value.compensation ?? "", deadline: value.deadline ?? ""
});

export const opportunityInputForDraft = (value: OpportunityDraftFields): OpportunityPostInputContract => ({
  kind: value.kind, status: value.status, location: value.location.trim() || null,
  compensation: value.compensation.trim() || null, deadline: value.deadline || null
});

const kindLabels: Record<OpportunityKindContract, string> = {
  job: "Job", bounty: "Bounty", collaboration: "Collaboration", grant: "Grant",
  internship: "Internship", fellowship: "Fellowship", residency: "Residency",
  open_call: "Open call", open_problem: "Open problem", event: "Event"
};

const opportunitySyncChannel = "symposium-opportunity-applications-v1";
const opportunitySyncStorageKey = "symposium-opportunity-applications-change";
const announceOpportunityChange = (postId: string) => {
  window.dispatchEvent(new CustomEvent("symposium-opportunity-applications-change", { detail: { postId } }));
  const message = { postId, changedAt: new Date().toISOString(), sourceId: crypto.randomUUID() };
  try { const channel = new BroadcastChannel(opportunitySyncChannel); channel.postMessage(message); channel.close(); } catch { /* storage transport remains */ }
  try { window.localStorage.setItem(opportunitySyncStorageKey, JSON.stringify(message)); } catch { /* authoritative persistence is unaffected */ }
};

const useOpportunityChange = (postId: string, refresh: () => void) => {
  useEffect(() => {
    const local = (event: Event) => {
      const detail = (event as CustomEvent<{ postId?: string }>).detail;
      if (!detail?.postId || detail.postId === postId) refresh();
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== opportunitySyncStorageKey || !event.newValue) return;
      try { if ((JSON.parse(event.newValue) as { postId?: string }).postId === postId) refresh(); } catch { /* ignore malformed external values */ }
    };
    const channel = "BroadcastChannel" in window ? new BroadcastChannel(opportunitySyncChannel) : null;
    if (channel) channel.onmessage = (event) => { if ((event.data as { postId?: string })?.postId === postId) refresh(); };
    window.addEventListener("symposium-opportunity-applications-change", local);
    window.addEventListener("storage", storage);
    return () => { channel?.close(); window.removeEventListener("symposium-opportunity-applications-change", local); window.removeEventListener("storage", storage); };
  }, [postId, refresh]);
};

export function OpportunityFields({ value, onChange, disabled, allowStatus = false }: {
  value: OpportunityDraftFields;
  onChange: (value: OpportunityDraftFields) => void;
  disabled?: boolean;
  allowStatus?: boolean;
}) {
  const update = <K extends keyof OpportunityDraftFields>(key: K, next: OpportunityDraftFields[K]) => onChange({ ...value, [key]: next });
  return <fieldset className="opportunity-fields" disabled={disabled}>
    <legend>Opportunity details</legend>
    <div className="opportunity-field-grid">
      <label><span>Type</span><select value={value.kind} onChange={(event) => update("kind", event.target.value as OpportunityKindContract)}>
        {Object.entries(kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
      </select></label>
      <label><span>Location <small>optional</small></span><input value={value.location} onChange={(event) => update("location", event.target.value)} placeholder="Remote, New York, hybrid…" /></label>
      <label><span>Compensation <small>optional</small></span><input value={value.compensation} onChange={(event) => update("compensation", event.target.value)} placeholder="$5,000 bounty, paid role…" /></label>
      <label><span>Deadline <small>optional</small></span><input type="date" value={value.deadline} onChange={(event) => update("deadline", event.target.value)} /></label>
      {allowStatus ? <label><span>Status</span><select value={value.status} onChange={(event) => update("status", event.target.value as "open" | "closed")}><option value="open">Open</option><option value="closed">Closed</option></select></label> : null}
    </div>
  </fieldset>;
}

const deadlineLabel = (deadline: string | null) => deadline
  ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${deadline}T12:00:00`))
  : "No deadline";

export function OpportunityFeedSummary({ item }: { item: InquiryItem }) {
  const opportunity = item.opportunity;
  if (!opportunity) return null;
  return <div className="opportunity-feed-summary">
    <span className={`opportunity-status opportunity-status-${opportunity.status}`}>{opportunity.status}</span>
    <strong>{kindLabels[opportunity.kind]}</strong>
    {opportunity.location ? <span><MapPin size={13} />{opportunity.location}</span> : null}
    {opportunity.compensation ? <span><BriefcaseBusiness size={13} />{opportunity.compensation}</span> : null}
    <span><CalendarDays size={13} />{deadlineLabel(opportunity.deadline)}</span>
  </div>;
}

export function OpportunityRail({ item, actorHandle, onApply, onReview }: {
  item: InquiryItem;
  actorHandle: string;
  onApply: (item: InquiryItem) => void;
  onReview: (item: InquiryItem) => void;
}) {
  const opportunity = item.opportunity;
  const owner = item.authorHandle === actorHandle;
  const [ownApplication, setOwnApplication] = useState<OpportunityApplicationContract | null>(null);
  const [applicationCount, setApplicationCount] = useState(item.opportunity?.applicationCount ?? 0);
  const refresh = useCallback(async () => {
    if (!opportunity) return;
    try {
      if (owner) {
        const data = await symposiumApi.request<{ applications: OpportunityApplicationContract[] }>(`/api/posts/${encodeURIComponent(item.id)}/opportunity/applications?actorHandle=${encodeURIComponent(actorHandle)}`, { cache: "no-store" });
        setApplicationCount(data.applications.length);
      } else {
        const data = await symposiumApi.request<{ application: OpportunityApplicationContract | null }>(`/api/posts/${encodeURIComponent(item.id)}/opportunity/application?actorHandle=${encodeURIComponent(actorHandle)}`, { cache: "no-store" });
        setOwnApplication(data.application);
      }
    } catch { /* authorization and disconnected preview are represented by the action state */ }
  }, [actorHandle, item.id, opportunity, owner]);
  useEffect(() => { void refresh(); }, [refresh]);
  useOpportunityChange(item.id, refresh);
  if (!opportunity) return null;
  const deadlinePassed = Boolean(opportunity.deadline && opportunity.deadline < new Date().toISOString().slice(0, 10));
  const applicationsOpen = opportunity.status === "open" && !deadlinePassed;
  return <aside className="opportunity-side">
    <section>
      <div className="opportunity-side-heading"><span>Opportunity</span><strong className={`opportunity-status opportunity-status-${opportunity.status}`}>{opportunity.status}</strong></div>
      <dl>
        <div><dt>Type</dt><dd>{kindLabels[opportunity.kind]}</dd></div>
        <div><dt>Location</dt><dd>{opportunity.location ?? "Not specified"}</dd></div>
        <div><dt>Compensation</dt><dd>{opportunity.compensation ?? "Not specified"}</dd></div>
        <div><dt>Deadline</dt><dd>{deadlineLabel(opportunity.deadline)}</dd></div>
      </dl>
      {owner ? <a className="opportunity-primary-action" href={canonicalRouteHref({ kind: "opportunityApplications", postId: item.id })} onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onReview(item); }}>
        View applications <span>{applicationCount}</span><ExternalLink size={15} />
      </a> : ownApplication ? <button type="button" className="opportunity-applied" disabled><Check size={15} />Application submitted</button>
        : <button type="button" className="opportunity-primary-action" disabled={!applicationsOpen} onClick={() => onApply(item)}>{applicationsOpen ? "Apply" : deadlinePassed ? "Deadline passed" : "Applications closed"}</button>}
    </section>
  </aside>;
}

export function OpportunityApplyModal({ item, actorHandle, onClose, onUploadAttachment, onApplied }: {
  item: InquiryItem; actorHandle: string; onClose: () => void; onUploadAttachment: AttachmentUploadHandler; onApplied: () => void;
}) {
  const [statement, setStatement] = useState("");
  const [attachments, setAttachments] = useState<InquiryAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const upload = async (file: File) => {
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) { setStatus("Applications accept document attachments only."); return; }
    setBusy(true); setStatus("Uploading document…");
    try { const attachment = await onUploadAttachment(file); setAttachments((current) => [...current, attachment]); setStatus("Document attached"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Document could not be attached"); }
    finally { setBusy(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!statement.trim() || busy) return;
    setBusy(true); setStatus("Submitting application…");
    try {
      await symposiumApi.request(`/api/posts/${encodeURIComponent(item.id)}/opportunity/application`, {
        method: "POST", idempotencyKey: createClientMutationId("opportunity-application-create"),
        body: { actorHandle, statement: statement.trim(), attachmentIds: attachments.map((attachment) => attachment.id) }
      });
      announceOpportunityChange(item.id); onApplied(); onClose();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Application could not be submitted"); }
    finally { setBusy(false); }
  };
  return <div className="composer-modal-backdrop" role="presentation" onClick={onClose}><form className="opportunity-apply-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
    <header><div><span>Apply to</span><strong>{item.title}</strong></div><button type="button" title="Close" onClick={onClose}><X size={17} /></button></header>
    <label><span>Application note</span><textarea value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="Why this work, what you would bring, and anything the poster should know." rows={9} /></label>
    <div className="opportunity-application-attachments">
      {attachments.map((attachment) => <span key={attachment.id}><FileText size={14} />{attachment.fileName}<button type="button" title="Remove" onClick={() => setAttachments((current) => current.filter((entry) => entry.id !== attachment.id))}><X size={13} /></button></span>)}
      <label className="opportunity-attach"><Paperclip size={15} />Attach documents<input type="file" multiple accept=".pdf,.doc,.docx,.txt,.rtf,.odt,.csv,.xls,.xlsx,.ppt,.pptx,.md,.tex" disabled={busy} onChange={(event) => { for (const file of Array.from(event.target.files ?? [])) void upload(file); event.currentTarget.value = ""; }} /></label>
    </div>
    {status ? <small>{status}</small> : null}<footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={busy || !statement.trim()}>{busy ? "Submitting…" : "Submit application"}</button></footer>
  </form></div>;
}

export function OpportunityApplicationsView({ item, actorHandle, initialApplicationId, onBack }: {
  item: InquiryItem; actorHandle: string; initialApplicationId?: string; onBack: () => void;
}) {
  const [applications, setApplications] = useState<OpportunityApplicationContract[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialApplicationId ?? null);
  const [shortlistedOnly, setShortlistedOnly] = useState(false);
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [status, setStatus] = useState("Loading applications…");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachmentIndex, setAttachmentIndex] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const data = await symposiumApi.request<{ applications: OpportunityApplicationContract[] }>(`/api/posts/${encodeURIComponent(item.id)}/opportunity/applications?actorHandle=${encodeURIComponent(actorHandle)}`, { cache: "no-store" });
      setApplications(data.applications); setStatus(data.applications.length ? "" : "No applications yet");
      setSelectedId((current) => current && data.applications.some((application) => application.id === current) ? current : data.applications[0]?.id ?? null);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Applications could not be loaded"); }
  }, [actorHandle, item.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  useOpportunityChange(item.id, refresh);
  const filtered = useMemo(() => [...applications].filter((application) => !shortlistedOnly || application.shortlisted).sort((left, right) => sort === "name" ? left.applicantName.localeCompare(right.applicantName) : sort === "oldest" ? left.createdAt.localeCompare(right.createdAt) : right.createdAt.localeCompare(left.createdAt)), [applications, shortlistedOnly, sort]);
  const selected = applications.find((application) => application.id === selectedId) ?? null;
  useEffect(() => { setAttachmentIndex(0); setNote(""); }, [selectedId]);
  const replace = (application: OpportunityApplicationContract) => setApplications((current) => current.map((entry) => entry.id === application.id ? application : entry));
  const toggleShortlist = async (application: OpportunityApplicationContract) => {
    if (busy) return;
    setBusy(true); setStatus("Updating shortlist…");
    try {
      const data = await symposiumApi.request<{ application: OpportunityApplicationContract }>(`/api/posts/${encodeURIComponent(item.id)}/opportunity/applications/${encodeURIComponent(application.id)}`, { method: "PATCH", idempotencyKey: createClientMutationId("opportunity-application-shortlist"), body: { actorHandle, shortlisted: !application.shortlisted, expectedRevision: application.revision } });
      replace(data.application); setStatus(""); announceOpportunityChange(item.id);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Shortlist could not be updated"); }
    finally { setBusy(false); }
  };
  const remove = async (application: OpportunityApplicationContract) => {
    if (!window.confirm(`Permanently delete ${application.applicantName}'s application, its private notes, and all attachments? This cannot be undone.`)) return;
    if (busy) return;
    setBusy(true); setStatus("Permanently deleting application…");
    try {
      await symposiumApi.request(`/api/posts/${encodeURIComponent(item.id)}/opportunity/applications/${encodeURIComponent(application.id)}`, { method: "DELETE", idempotencyKey: createClientMutationId("opportunity-application-delete"), body: { actorHandle } });
      const remaining = applications.filter((entry) => entry.id !== application.id);
      setApplications(remaining); setSelectedId(remaining[0]?.id ?? null); setStatus(remaining.length ? "" : "No applications yet"); announceOpportunityChange(item.id);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Application could not be deleted"); }
    finally { setBusy(false); }
  };
  const addNote = async () => {
    if (!selected || !note.trim() || busy) return;
    setBusy(true); setStatus("Saving private note…");
    try {
      const data = await symposiumApi.request<{ application: OpportunityApplicationContract }>(`/api/posts/${encodeURIComponent(item.id)}/opportunity/applications/${encodeURIComponent(selected.id)}/comments`, { method: "POST", idempotencyKey: createClientMutationId("opportunity-application-note"), body: { actorHandle, body: note.trim() } });
      replace(data.application); setNote(""); setStatus(""); announceOpportunityChange(item.id);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Private note could not be saved"); }
    finally { setBusy(false); }
  };
  const activeAttachment = selected?.attachments[attachmentIndex] ?? null;
  return <div className="opportunity-review-layout">
    <aside className="opportunity-review-filters"><button className="back-button" type="button" onClick={onBack}><ArrowLeft size={17} />Back to opportunity</button><p className="eyebrow">Applications</p><h1>{item.title}</h1><nav>
      <button type="button" className={!shortlistedOnly ? "active" : ""} aria-pressed={!shortlistedOnly} onClick={() => setShortlistedOnly(false)}>All <span>{applications.length}</span></button>
      <button type="button" className={shortlistedOnly ? "active" : ""} aria-pressed={shortlistedOnly} onClick={() => setShortlistedOnly(true)}><Star size={14} />Shortlisted <span>{applications.filter((application) => application.shortlisted).length}</span></button>
    </nav><label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Applicant name</option></select></label></aside>
    <main className="opportunity-applicant-feed"><header><div><strong>{shortlistedOnly ? "Shortlisted" : "All applicants"}</strong><span>{filtered.length}</span></div><small>{status}</small></header>
      {filtered.map((application) => <article key={application.id} className={`${selectedId === application.id ? "selected" : ""}${application.shortlisted ? " shortlisted" : ""}`} onClick={() => setSelectedId(application.id)}>
        <div className="opportunity-applicant-avatar">{application.applicantName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</div><div><strong>{application.applicantName}</strong><span>{application.applicantAffiliation}</span><p>{application.statement}</p><small>{application.attachments.length} file{application.attachments.length === 1 ? "" : "s"} · {application.comments.length} note{application.comments.length === 1 ? "" : "s"}</small></div>
        <div className="opportunity-applicant-metrics"><button type="button" title="Shortlist" aria-pressed={application.shortlisted} className={application.shortlisted ? "active" : ""} disabled={busy} onClick={(event) => { event.stopPropagation(); void toggleShortlist(application); }}><Star size={15} /></button><button type="button" title="Delete" disabled={busy} onClick={(event) => { event.stopPropagation(); void remove(application); }}><Trash2 size={15} /></button><button type="button" title="Private notes" onClick={(event) => { event.stopPropagation(); setSelectedId(application.id); }}><MessageCircle size={15} /><span>{application.comments.length}</span></button><a title="Application link" href={`${canonicalRouteHref({ kind: "opportunityApplications", postId: item.id, applicationId: application.id })}`} onClick={(event) => event.stopPropagation()}><Link2 size={15} /></a></div>
      </article>)}
    </main>
    <aside className="opportunity-review-detail">{selected ? <>
      <header><div><span>Application</span><strong>{selected.applicantName}</strong><small>{selected.applicantHandle}</small></div><div><button type="button" className={selected.shortlisted ? "active" : ""} aria-pressed={selected.shortlisted} disabled={busy} onClick={() => void toggleShortlist(selected)}><Star size={16} />{selected.shortlisted ? "Shortlisted" : "Shortlist"}</button><button type="button" className="danger-action" disabled={busy} onClick={() => void remove(selected)}><Trash2 size={16} />Delete</button></div></header>
      <p className="opportunity-application-statement">{selected.statement}</p>
      {activeAttachment ? <section className="opportunity-document-shuffle"><div onClick={() => setPreview(activeAttachment.id)}><FileText size={38} /><strong>{activeAttachment.fileName}</strong><span>Open document</span></div>{selected.attachments.length > 1 ? <footer><button type="button" disabled={attachmentIndex === 0} onClick={() => setAttachmentIndex((index) => index - 1)}><ChevronLeft size={16} /></button><span>{attachmentIndex + 1} / {selected.attachments.length}</span><button type="button" disabled={attachmentIndex === selected.attachments.length - 1} onClick={() => setAttachmentIndex((index) => index + 1)}><ChevronRight size={16} /></button></footer> : null}</section> : <div className="opportunity-no-documents"><Paperclip size={20} />No documents attached</div>}
      <section className="opportunity-private-notes"><h2>Private review notes</h2>{selected.comments.map((comment) => <div key={comment.id}><strong>{comment.authorName}</strong><p>{comment.body}</p></div>)}<textarea value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="Jot down what you noticed while reviewing…" rows={4} /><button type="button" disabled={busy || !note.trim()} onClick={() => void addNote()}>Add note</button></section>
      {preview ? <AttachmentPreviewModal attachments={selected.attachments} contextTitle={`${selected.applicantName} — application`} attachmentId={preview} onClose={() => setPreview(null)} /> : null}
    </> : <div className="opportunity-review-empty"><BriefcaseBusiness size={28} /><strong>Select an applicant</strong><span>Their application and documents will open here.</span></div>}</aside>
  </div>;
}
