"use client";

import { MessageCircleMore, Search, ShieldCheck, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommunityMemberContract, CommunityMemberPageContract } from "@/packages/contracts/src";
import type { ResearchCommunity, ResearchProfile } from "@/lib/mockData";
import { cleanHandle } from "@/lib/symposiumCore";
import { profileForHandle } from "@/features/identity/profilePresentation";
import { symposiumApi } from "@/features/api/symposiumApiClient";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";

type PeopleMode = "members" | "moderators";

const joinedLabel = (joinedAt: string) => {
  const date = new Date(joinedAt);
  if (Number.isNaN(date.getTime())) return "Member";
  return `Joined ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(date)}`;
};

export function CommunityPeopleModal({
  community,
  currentProfileHandle,
  profiles,
  mode,
  onClose,
  onOpenProfile,
  onMessage
}: {
  community: ResearchCommunity;
  currentProfileHandle: string;
  profiles: Record<string, ResearchProfile>;
  mode: PeopleMode;
  onClose: () => void;
  onOpenProfile: (handle: string) => void;
  onMessage?: (handle: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<CommunityMemberContract[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const requestVersion = useRef(0);
  const moderatorHandles = useMemo(() => new Set((community.moderatorHandles ?? []).map(cleanHandle)), [community.moderatorHandles]);
  const fallbackMembers = useMemo(() => community.memberHandles
    .map((handle, index) => {
      const clean = cleanHandle(handle);
      const person = profileForHandle(profiles, clean);
      const role = index === 0 ? "owner" as const : moderatorHandles.has(clean) ? "moderator" as const : "member" as const;
      return {
        handle: clean,
        name: person?.name ?? clean,
        avatarUrl: person?.avatarUrl,
        role,
        joinedAt: new Date(Date.UTC(2026, 6, 15 - Math.floor(index / 18), 18, index % 60)).toISOString()
      } satisfies CommunityMemberContract;
    })
    .filter((member) => mode === "members" || member.role === "owner" || member.role === "moderator")
    .filter((member) => !query.trim() || `${member.name} ${member.handle}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 50), [community.memberHandles, mode, moderatorHandles, profiles, query]);

  const endpoint = (cursor?: string | null) => {
    const params = new URLSearchParams({
      actorHandle: currentProfileHandle,
      q: query.trim(),
      limit: "50",
      role: mode === "moderators" ? "moderators" : "all"
    });
    if (cursor) params.set("cursor", cursor);
    return `/api/communities/${encodeURIComponent(community.id)}/members?${params}`;
  };

  useEffect(() => {
    const version = ++requestVersion.current;
    const controller = new AbortController();
    setMembers(fallbackMembers);
    setTotal(query.trim() ? fallbackMembers.length : mode === "members" ? community.memberCount ?? community.memberHandles.length : fallbackMembers.length);
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

  const title = mode === "moderators" ? "Community moderators" : "Community members";
  return (
    <div className="community-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="community-people-modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>{community.name}</span><strong>{title}</strong></div>
          <button type="button" title={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={18} /></button>
        </header>
        <label className="community-people-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === "moderators" ? "Search moderators" : "Quick search members"} autoFocus />
        </label>
        <div className="community-people-summary"><span>{total.toLocaleString()} {total === 1 ? "person" : "people"}</span><small>Newest members first</small></div>
        <div className="community-people-scroll" ref={scrollRef}>
          {members.map((member) => (
            <article className="community-person-row" key={member.handle}>
              <CanonicalLink route={{ kind: "profile", handle: member.handle }} onNavigate={() => { onClose(); onOpenProfile(member.handle); }}>
                <i>{member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : member.name.slice(0, 1)}</i>
                <span><strong>{member.name}</strong><small>{member.handle} · {joinedLabel(member.joinedAt)}</small></span>
                <em>{member.role === "owner" || member.role === "moderator" ? <ShieldCheck size={13} /> : <UsersRound size={13} />}{member.role}</em>
              </CanonicalLink>
              {mode === "moderators" && onMessage ? <button type="button" onClick={() => { onClose(); onMessage(member.handle); }}><MessageCircleMore size={15} /> Message</button> : null}
            </article>
          ))}
          {!members.length && !loading ? <p className="community-people-empty">No one matches this search.</p> : null}
          <div ref={sentinelRef} className="community-people-sentinel" aria-hidden="true" />
          {loading || loadingMore ? <p className="community-people-loading">Loading live member records…</p> : null}
          {status ? <p className="community-people-status" role="status">{status}</p> : null}
        </div>
      </section>
    </div>
  );
}
