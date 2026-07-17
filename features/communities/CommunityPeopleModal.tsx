"use client";

import { Check, MessageCircleMore, Search, ShieldCheck, Trash2, UserRoundCog, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommunityMemberContract, CommunityMemberPageContract } from "@/packages/contracts/src";
import type { ResearchCommunity, ResearchProfile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import { profileForHandle } from "@/features/identity/profilePresentation";
import { symposiumApi } from "@/features/api/symposiumApiClient";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";

type PeopleMode = "members" | "moderators" | "requests";

const joinedLabel = (joinedAt: string, request = false) => {
  const date = new Date(joinedAt);
  if (Number.isNaN(date.getTime())) return request ? "Requested" : "Member";
  return `${request ? "Requested" : "Joined"} ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(date)}`;
};

export function CommunityPeopleModal({
  community,
  currentProfileHandle,
  profiles,
  mode,
  onClose,
  onOpenProfile,
  onMessage,
  canManage = false,
  onUpdateRole,
  onRemoveMember,
  onResolveRequest
}: {
  community: ResearchCommunity;
  currentProfileHandle: string;
  profiles: Record<string, ResearchProfile>;
  mode: PeopleMode;
  onClose: () => void;
  onOpenProfile: (handle: string) => void;
  onMessage?: (handle: string) => void;
  canManage?: boolean;
  onUpdateRole?: (memberHandle: string, role: "moderator" | "member") => Promise<{ ok: boolean; error?: string }>;
  onRemoveMember?: (memberHandle: string) => Promise<{ ok: boolean; error?: string }>;
  onResolveRequest?: (memberHandle: string, decision: "approve" | "decline") => Promise<{ ok: boolean; error?: string }>;
}) {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<CommunityMemberContract[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState("");
  const [managingHandle, setManagingHandle] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestVersion = useRef(0);
  const moderatorHandles = useMemo(() => new Set((community.moderatorHandles ?? []).map(cleanHandle)), [community.moderatorHandles]);
  const ownerHandle = cleanHandle(community.ownerHandle ?? community.memberHandles[0] ?? "");
  const fallbackMembers = useMemo(() => community.memberHandles
    .map((handle, index) => {
      const clean = cleanHandle(handle);
      const person = profileForHandle(profiles, clean);
      const role = clean === ownerHandle ? "owner" as const : moderatorHandles.has(clean) ? "moderator" as const : "member" as const;
      return {
        handle: clean,
        name: person?.name ?? clean,
        avatarUrl: person?.avatarUrl,
        role,
        joinedAt: new Date(Date.UTC(2026, 6, 15 - Math.floor(index / 18), 18, index % 60)).toISOString()
      } satisfies CommunityMemberContract;
    })
    .filter((member) => mode !== "requests" && (mode === "members" || member.role === "owner" || member.role === "moderator"))
    .filter((member) => !query.trim() || `${member.name} ${member.handle}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 50), [community.memberHandles, mode, moderatorHandles, ownerHandle, profiles, query]);

  const endpoint = (cursor?: string | null) => {
    const params = new URLSearchParams({
      actorHandle: currentProfileHandle,
      q: query.trim(),
      limit: "50",
      role: mode === "moderators" ? "moderators" : "all",
      status: mode === "requests" ? "requested" : "active"
    });
    if (cursor) params.set("cursor", cursor);
    return `/api/communities/${encodeURIComponent(community.id)}/members?${params}`;
  };

  useEffect(() => {
    const version = ++requestVersion.current;
    const controller = new AbortController();
    setMembers(fallbackMembers);
    setTotal(query.trim() || mode === "requests" ? fallbackMembers.length : mode === "members" ? community.memberCount ?? community.memberHandles.length : fallbackMembers.length);
    setNextCursor(null);
    setLoading(true);
    setLoadingMore(false);
    setStatus("");
    const timer = window.setTimeout(() => {
      symposiumApi.request<CommunityMemberPageContract>(endpoint(), { cache: "no-store", signal: controller.signal })
        .then((page) => {
          if (controller.signal.aborted || version !== requestVersion.current) return;
          setMembers(page.members);
          setNextCursor(page.nextCursor);
          setTotal(page.total);
        })
        .catch(() => {
          if (!controller.signal.aborted && version === requestVersion.current) setStatus("Live member results are reconnecting.");
        })
        .finally(() => {
          if (!controller.signal.aborted && version === requestVersion.current) setLoading(false);
        });
    }, query ? 180 : 0);
    return () => {
      requestVersion.current += 1;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [community.id, community.memberCount, community.memberHandles.length, currentProfileHandle, fallbackMembers, mode, query]);

  const loadMore = async () => {
    if (!nextCursor || loading || loadingMore) return;
    const cursor = nextCursor;
    const version = requestVersion.current;
    setLoadingMore(true);
    setStatus("");
    try {
      const page = await symposiumApi.request<CommunityMemberPageContract>(endpoint(cursor), { cache: "no-store" });
      if (version !== requestVersion.current) return;
      setMembers((current) => {
        const seen = new Set(current.map((member) => member.handle));
        return [...current, ...page.members.filter((member) => !seen.has(member.handle))];
      });
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch {
      if (version === requestVersion.current) setStatus("More members could not be loaded yet.");
    } finally {
      if (version === requestVersion.current) setLoadingMore(false);
    }
  };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !nextCursor || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void loadMore();
    }, { root, rootMargin: "160px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, loadingMore, nextCursor]);

  const title = mode === "moderators" ? "Community moderators" : mode === "requests" ? "Join requests" : "Community members";
  const changeRole = async (member: CommunityMemberContract) => {
    if (!onUpdateRole || managingHandle) return;
    const role = member.role === "moderator" ? "member" : "moderator";
    setManagingHandle(member.handle);
    setStatus("");
    const result = await onUpdateRole(member.handle, role);
    setManagingHandle(null);
    if (result.ok) setMembers((current) => current.map((candidate) => candidate.handle === member.handle ? { ...candidate, role } : candidate));
    else setStatus(result.error ?? "Member role could not be changed.");
  };
  const removeMember = async (member: CommunityMemberContract) => {
    if (!onRemoveMember || managingHandle || !window.confirm(`Remove ${member.name} from ${community.name}?`)) return;
    setManagingHandle(member.handle);
    setStatus("");
    const result = await onRemoveMember(member.handle);
    setManagingHandle(null);
    if (result.ok) {
      setMembers((current) => current.filter((candidate) => candidate.handle !== member.handle));
      setTotal((current) => Math.max(0, current - 1));
    } else setStatus(result.error ?? "Member could not be removed.");
  };
  const resolveRequest = async (member: CommunityMemberContract, decision: "approve" | "decline") => {
    if (!onResolveRequest || managingHandle) return;
    setManagingHandle(member.handle);
    setStatus("");
    const result = await onResolveRequest(member.handle, decision);
    setManagingHandle(null);
    if (result.ok) {
      setMembers((current) => current.filter((candidate) => candidate.handle !== member.handle));
      setTotal((current) => Math.max(0, current - 1));
    } else setStatus(result.error ?? "Join request could not be updated.");
  };
  return (
    <div className="community-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="community-people-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>{community.name}</span><strong>{title}</strong></div>
          <button type="button" title={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={18} /></button>
        </header>
        <label className="community-people-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "moderators" ? "Search moderators" : mode === "requests" ? "Search join requests" : "Quick search members"} autoFocus />
        </label>
        <div className="community-people-summary"><span>{total.toLocaleString()} {mode === "requests" ? total === 1 ? "request" : "requests" : total === 1 ? "person" : "people"}</span><small>{mode === "requests" ? "Newest requests first" : "Newest members first"}</small></div>
        <div className="community-people-scroll" ref={scrollRef}>
          {members.map((member) => (
            <article className="community-person-row" key={member.handle}>
              <CanonicalLink route={{ kind: "profile", handle: member.handle }} onNavigate={() => { onClose(); onOpenProfile(member.handle); }}>
                <i>{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : member.name.slice(0, 1)}</i>
                <span><strong>{member.name}</strong><small>{member.handle} · {joinedLabel(member.joinedAt, mode === "requests")}</small></span>
                <em>{mode === "requests" ? <UsersRound size={13} /> : member.role === "owner" || member.role === "moderator" ? <ShieldCheck size={13} /> : <UsersRound size={13} />}{mode === "requests" ? "request" : member.role}</em>
              </CanonicalLink>
              {mode === "moderators" && onMessage ? <button type="button" onClick={() => { onClose(); onMessage(member.handle); }}><MessageCircleMore size={15} /> Message</button> : null}
              {mode === "members" && canManage && member.role !== "owner" && cleanHandle(member.handle) !== cleanHandle(currentProfileHandle) ? (
                <div className="community-person-controls">
                  <button type="button" disabled={managingHandle !== null} onClick={() => void changeRole(member)} title={member.role === "moderator" ? "Return to member" : "Promote to moderator"}>
                    <UserRoundCog size={15} /> {managingHandle === member.handle ? "Updating…" : member.role === "moderator" ? "Make member" : "Make moderator"}
                  </button>
                  <button className="danger-action" type="button" disabled={managingHandle !== null} onClick={() => void removeMember(member)} title="Remove member"><Trash2 size={15} /></button>
                </div>
              ) : null}
              {mode === "requests" && canManage && onResolveRequest ? (
                <div className="community-request-controls">
                  <button type="button" disabled={managingHandle !== null} onClick={() => void resolveRequest(member, "approve")} title="Approve join request"><Check size={15} /> {managingHandle === member.handle ? "Updating…" : "Approve"}</button>
                  <button className="danger-action" type="button" disabled={managingHandle !== null} onClick={() => void resolveRequest(member, "decline")} title="Decline join request"><X size={15} /> Decline</button>
                </div>
              ) : null}
            </article>
          ))}
          {!members.length && !loading ? <p className="community-people-empty">{mode === "requests" && !query.trim() ? "No pending join requests." : "No one matches this search."}</p> : null}
          <div ref={sentinelRef} className="community-people-sentinel" aria-hidden="true" />
          {loading || loadingMore ? <p className="community-people-loading">Loading live {mode === "requests" ? "join requests" : "member records"}…</p> : null}
          {status ? <p className="community-people-status" role="status">{status}</p> : null}
        </div>
      </section>
    </div>
  );
}
