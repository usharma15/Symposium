"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Crown, Search, ShieldCheck, UserPlus, Users, X } from "lucide-react";
import { profileInitials } from "@/features/identity/profilePresentation";
import type { ResearchProfile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import { useWorkspaceAccess, type WorkspaceAccessTarget } from "@/features/workspace/useWorkspaceAccess";
import {
  workspaceAccessRoleRank,
  type WorkspaceGrantRoleContract
} from "@/packages/contracts/src";
import type { WorkspaceCollaboratorSearchResponse } from "@/lib/workspaceTypes";

const roles: WorkspaceGrantRoleContract[] = ["viewer", "commenter", "editor", "publisher"];
const roleLabel: Record<WorkspaceGrantRoleContract, string> = {
  viewer: "Can view",
  commenter: "Can comment",
  editor: "Can edit",
  publisher: "Can publish"
};
const roleDescription: Record<WorkspaceGrantRoleContract, string> = {
  viewer: "Read the shared work",
  commenter: "Read and join its private discussion",
  editor: "Comment, edit, and share up to Editor",
  publisher: "Edit, publish, and share up to Publisher"
};

export function WorkspaceSharingDialog({
  target,
  actorHandle,
  profiles,
  onClose,
  onChanged,
  onLostAccess,
  onOpenNotebookAccess
}: {
  target: WorkspaceAccessTarget;
  actorHandle: string;
  profiles: Record<string, ResearchProfile>;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onLostAccess: () => void;
  onOpenNotebookAccess: (notebookId: string) => void;
}) {
  const accessState = useWorkspaceAccess(target, actorHandle, onChanged, onLostAccess);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceCollaboratorSearchResponse["people"]>([]);
  const [searching, setSearching] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [selectedHandle, setSelectedHandle] = useState("");
  const [selectedRole, setSelectedRole] = useState<WorkspaceGrantRoleContract>("viewer");
  const searchRef = useRef<HTMLInputElement>(null);
  function currentPerson<T extends { handle: string; name: string; avatarUrl?: string }>(person: T): T {
    const current = profiles[cleanHandle(person.handle)];
    return current ? { ...person, name: current.name, avatarUrl: current.avatarUrl } : person;
  }

  useEffect(() => {
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeForEscape);
    return () => window.removeEventListener("keydown", closeForEscape);
  }, [onClose]);

  useEffect(() => {
    setQuery("");
    setResults([]);
    setSearchedQuery("");
    setSelectedHandle("");
    setSelectedRole("viewer");
  }, [target.id, target.type]);

  useEffect(() => {
    const phrase = query.trim();
    if (phrase.length < 1 || selectedHandle) {
      setResults([]);
      setSearching(false);
      setSearchedQuery("");
      return;
    }
    setSearching(true);
    setSearchedQuery("");
    let active = true;
    const timer = window.setTimeout(() => {
      void accessState.searchPeople(phrase)
        .then((response) => {
          if (!active) return;
          setResults(response.people);
          setSearchedQuery(phrase);
        })
        .catch(() => {
          if (!active) return;
          setResults([]);
          setSearchedQuery(phrase);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [accessState.searchPeople, query, selectedHandle]);

  const access = accessState.access;
  const allowedRoles = useMemo(() => roles.filter((role) => access?.actor.maxGrantRole
    && workspaceAccessRoleRank[role] <= workspaceAccessRoleRank[access.actor.maxGrantRole]), [access?.actor.maxGrantRole]);
  useEffect(() => {
    if (allowedRoles.length && !allowedRoles.includes(selectedRole)) setSelectedRole(allowedRoles[0]!);
  }, [allowedRoles, selectedRole]);

  const existingHandles = useMemo(() => new Set([
    access?.owner.handle,
    ...(access?.collaborators.map((collaborator) => collaborator.handle) ?? [])
  ].filter(Boolean)), [access]);
  const availableResults = results.filter((person) => !existingHandles.has(person.handle));

  const choosePerson = (person: WorkspaceCollaboratorSearchResponse["people"][number]) => {
    setSelectedHandle(person.handle);
    setQuery(`${person.name} · ${person.handle}`);
    setResults([]);
  };

  const invite = async () => {
    if (!selectedHandle) return;
    const shared = await accessState.invite(selectedHandle, selectedRole);
    if (!shared) return;
    setSelectedHandle("");
    setQuery("");
    setSelectedRole("viewer");
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };

  return (
    <div className="workspace-sharing-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="workspace-sharing-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-sharing-title">
        <header className="workspace-sharing-header">
          <div>
            <span><Users size={17} />Sharing and collaboration</span>
            <h2 id="workspace-sharing-title">{access?.resource.name ?? "Opening access settings…"}</h2>
          </div>
          <button type="button" title="Close sharing" onClick={onClose}><X size={18} /></button>
        </header>

        <p className="workspace-sharing-privacy">
          {target.type === "document"
            ? "Your Office remains private. Only this draft is shared."
            : "Your Office remains private. Only this notebook and its contents are shared."}
        </p>

        {accessState.loading && !access ? <div className="workspace-sharing-loading">Loading current access…</div> : null}
        {accessState.error ? <div className="workspace-error" role="alert">{accessState.error}</div> : null}

        {access?.actor.canInvite ? (
          <div className="workspace-sharing-invite">
            <label>
              <span>Invite a Symposium participant</span>
              <div className="workspace-sharing-search">
                <Search size={16} />
                <input
                  ref={searchRef}
                  value={query}
                  autoComplete="off"
                  placeholder="Search by name or @handle"
                  onChange={(event) => { setQuery(event.target.value); setSelectedHandle(""); }}
                />
                {query ? <button type="button" title="Clear participant" onClick={() => { setQuery(""); setSelectedHandle(""); }}><X size={14} /></button> : null}
              </div>
            </label>
            <label>
              <span>Permission</span>
              <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as WorkspaceGrantRoleContract)}>
                {allowedRoles.map((role) => <option key={role} value={role}>{roleLabel[role]}</option>)}
              </select>
            </label>
            <button type="button" className="primary" disabled={!selectedHandle || accessState.busy} onClick={() => void invite()}>
              <UserPlus size={16} />Share
            </button>
            {selectedHandle ? <small className="workspace-sharing-role-help">{roleDescription[selectedRole]}</small> : null}
            {!selectedHandle && (searching || (query.trim().length > 0 && searchedQuery === query.trim())) ? (
              <div className="workspace-sharing-results" role="listbox" aria-label="Participant results">
                {searching ? <span>Searching…</span> : availableResults.map((result) => {
                  const person = currentPerson(result);
                  return (
                  <button type="button" role="option" key={person.handle} onClick={() => choosePerson(person)}>
                    <i>{person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : profileInitials(person.name)}</i>
                    <span><strong>{person.name}</strong><small>{person.handle} · {person.role}</small></span>
                  </button>
                  );
                })}
                {!searching && !availableResults.length ? <span>No new participants found.</span> : null}
              </div>
            ) : null}
          </div>
        ) : access ? (
          <div className="workspace-sharing-readonly"><ShieldCheck size={16} />You can see who has access. Only authorized editors, publishers, and the owner can invite others.</div>
        ) : null}

        {access ? (
          <div className="workspace-sharing-people">
            <header><strong>People with access</strong><span>{access.collaborators.length + 1}</span></header>
            <div className="workspace-sharing-person owner">
              <i>{currentPerson(access.owner).avatarUrl ? <img src={currentPerson(access.owner).avatarUrl} alt="" /> : profileInitials(currentPerson(access.owner).name)}</i>
              <span><strong>{currentPerson(access.owner).name}</strong><small>{access.owner.handle}</small></span>
              <em><Crown size={14} />Owner</em>
            </div>
            {access.collaborators.map((entry) => {
              const collaborator = currentPerson(entry);
              const direct = collaborator.directGrant;
              const inherited = collaborator.inheritedGrant;
              const isSelf = collaborator.handle === actorHandle;
              return (
                <div className="workspace-sharing-person" key={collaborator.handle}>
                  <i>{collaborator.avatarUrl ? <img src={collaborator.avatarUrl} alt="" /> : profileInitials(collaborator.name)}</i>
                  <span>
                    <strong>{collaborator.name}{isSelf ? " (you)" : ""}</strong>
                    <small>{collaborator.handle}</small>
                    {inherited ? <button type="button" onClick={() => onOpenNotebookAccess(inherited.notebookId)}>Via {inherited.notebookName} · {roleLabel[inherited.role]}</button> : null}
                    {direct && inherited ? <small>Direct and inherited access combine at the stronger level.</small> : null}
                  </span>
                  <div className="workspace-sharing-person-role">
                    {direct?.canManage ? (
                      <select
                        aria-label={`Access for ${collaborator.name}`}
                        value={direct.role}
                        disabled={accessState.busy}
                        onChange={(event) => void accessState.updateRole(collaborator.handle, direct, event.target.value as WorkspaceGrantRoleContract)}
                      >
                        {allowedRoles.map((role) => <option key={role} value={role}>{roleLabel[role]}</option>)}
                      </select>
                    ) : <em>{roleLabel[collaborator.effectiveRole]}</em>}
                    {direct?.canRemove ? <button type="button" className="danger" disabled={accessState.busy} onClick={() => {
                      const verb = isSelf ? "Leave" : "Remove";
                      if (window.confirm(`${verb} access for ${collaborator.name}?${inherited ? " Notebook access may still apply." : ""}`)) {
                        void accessState.remove(collaborator.handle, direct);
                      }
                    }}>{isSelf ? "Leave" : "Remove"}</button> : null}
                  </div>
                </div>
              );
            })}
            {!access.collaborators.length ? <div className="workspace-sharing-empty"><Check size={16} />Only the owner has access.</div> : null}
          </div>
        ) : null}

        <footer className="workspace-sharing-footer">
          <span aria-live="polite">{accessState.status}</span>
          <button type="button" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}
