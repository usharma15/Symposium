"use client";

import { Search, X } from "lucide-react";
import type { InquiryItem, ResearchProfile } from "@/lib/mockData";
import { profileInitials as initial } from "@/features/identity/profilePresentation";
import { kindLabels } from "@/features/posts/PostViews";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";

export function SearchModal({
  query,
  setQuery,
  results,
  loading,
  onClose,
  onOpenPost,
  onOpenProfile
}: {
  query: string;
  setQuery: (query: string) => void;
  results: {
    titleMatches: InquiryItem[];
    contentMatches: InquiryItem[];
    profileMatches: ResearchProfile[];
  };
  loading?: boolean;
  onClose: () => void;
  onOpenPost: (id: string) => void;
  onOpenProfile: (name: string) => void;
}) {
  const hasQuery = query.trim().length > 0;
  const hasResults =
    results.titleMatches.length || results.contentMatches.length || results.profileMatches.length;

  return (
    <div className="modal-backdrop search-backdrop" role="presentation" onClick={onClose}>
      <section className="search-modal" aria-label="Search Symposium" onClick={(event) => event.stopPropagation()}>
        <header>
          <label>
            <Search size={18} />
            <input
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search posts, comments, people"
            />
          </label>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="search-results">
          {!hasQuery ? (
            <p>Start typing to search across titles, bodies, comments, and profiles.</p>
          ) : loading && !hasResults ? (
            <p>Searching Symposium…</p>
          ) : hasResults ? (
            <>
              {results.titleMatches.length ? (
                <SearchResultGroup title="Title matches" items={results.titleMatches} onOpenPost={onOpenPost} />
              ) : null}
              {results.contentMatches.length ? (
                <SearchResultGroup title="Content and comments" items={results.contentMatches} onOpenPost={onOpenPost} />
              ) : null}
              {results.profileMatches.length ? (
                <section className="search-group">
                  <h2>People</h2>
                  {results.profileMatches.map((person) => (
                    <CanonicalLink
                      key={person.handle}
                      route={{ kind: "profile", handle: person.handle }}
                      onNavigate={() => onOpenProfile(person.handle)}
                    >
                      <span className="avatar small">{initial(person.name)}</span>
                      <span>
                        <strong>{person.name}</strong>
                        <small>{person.role}</small>
                      </span>
                    </CanonicalLink>
                  ))}
                </section>
              ) : null}
            </>
          ) : (
            <p>No results yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function SearchResultGroup({
  title,
  items,
  onOpenPost
}: {
  title: string;
  items: InquiryItem[];
  onOpenPost: (id: string) => void;
}) {
  return (
    <section className="search-group">
      <h2>{title}</h2>
      {items.slice(0, 8).map((item) => (
        <CanonicalLink
          key={item.id}
          route={{ kind: "post", postId: item.id }}
          onNavigate={() => onOpenPost(item.id)}
        >
          <span>{kindLabels[item.kind]}</span>
          <strong>{item.title}</strong>
          <small>
            {item.author} · {item.date}
          </small>
        </CanonicalLink>
      ))}
    </section>
  );
}
