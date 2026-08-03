import type { PoolClient } from "pg";
import type { AssistantContextContract } from "../../../../packages/contracts/src";

export type AssistantSiteSearchScope = "site" | "office" | "messages";

export type AssistantSiteSearchRequest = {
  query: string;
  scopes: AssistantSiteSearchScope[];
};

type SearchRow = {
  scope: AssistantSiteSearchScope;
  entityType: string;
  entityId: string;
  title: string;
  excerpt: string;
  route: string;
  revision: number | string | null;
  rank: number | string;
  markerId: string | null;
};

const explicitSearchLanguage =
  /\b(?:search|find|look\s+(?:for|through|up)|retrieve|pull\s+up|track\s+down|dig\s+(?:up|through)|scan)\b/i;

const scopeLanguage = {
  site: /\b(?:site|symposium|hall|room|community|communities|post|posts|paper|papers|thought|thoughts|comment|comments)\b/i,
  office: /\b(?:office|workspace|notebook|notebooks|note|notes|draft|drafts)\b/i,
  messages: /\b(?:message|messages|messaging|chat|chats|conversation|conversations|dm|dms)\b/i
} as const;

const allScopeLanguage = /\b(?:everywhere|everything|sitewide|site-wide|across\s+(?:the\s+)?site|all\s+(?:of\s+)?symposium)\b/i;

const negativeSearchLanguage =
  /\b(?:do\s+not|don't|dont|never)\s+(?:search|find|look\s+(?:for|through|up)|retrieve|pull\s+up|track\s+down|scan)\b/i;

const noteIntegrationLanguage =
  /\b(?:add|append|integrate|incorporate|merge)\b/i;

export const assistantNoteTargetTitleForPrompt = (request: string) => {
  const normalized = request.normalize("NFKC");
  if (
    !noteIntegrationLanguage.test(normalized) ||
    /\b(?:do\s+not|don't|dont|never)\s+(?:add|append|integrate|incorporate|merge)\b/i.test(normalized) ||
    /\b(?:publish|share|send|delete)\b/i.test(normalized)
  ) {
    return null;
  }
  const patterns = [
    /\b(?:into|to|in)\s+(?:my\s+)?(?:office\s+)?note\s+(?:(?:called|named|titled)\s+)?["“]([^"”]{1,240})["”]/i,
    /\b(?:note|draft)\s+(?:called|named|titled)\s+["“]([^"”]{1,240})["”]/i,
    /\b(?:into|to|in)\s+["“]([^"”]{1,240})["”]\s+(?:office\s+)?(?:note|draft)\b/i
  ];
  for (const pattern of patterns) {
    const title = normalized.match(pattern)?.[1]?.trim();
    if (title) return title;
  }
  return null;
};

const ignoredSearchTokens = new Set([
  "a", "about", "across", "add", "all", "an", "and", "anything", "append", "called", "chat", "chats",
  "comment", "comments", "community", "communities", "conversation", "conversations", "incorporate", "integrate", "into",
  "dig", "dm", "dms", "down", "draft", "drafts", "everything", "everywhere", "find", "for", "from", "hall",
  "in", "look", "message", "messages", "my", "note", "notebook", "notebooks", "notes",
  "named", "office", "on", "our", "paper", "papers", "please", "post", "posts", "related",
  "pull", "retrieve", "room", "scan", "search", "site", "sitewide", "something", "symposium", "the",
  "them", "this", "thought", "thoughts", "through", "titled", "track", "up", "workspace", "you"
]);

const cleanSearchQuery = (request: string) => {
  const noteTargetTitle = assistantNoteTargetTitleForPrompt(request);
  const quoted = Array.from(request.matchAll(/["“]([^"”]{2,160})["”]/g))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => value.toLocaleLowerCase() !== noteTargetTitle?.toLocaleLowerCase());
  if (quoted.length) return quoted.join(" ").slice(0, 160);

  const requestWithoutTarget = noteTargetTitle
    ? request.replace(noteTargetTitle, " ")
    : request;
  const normalized = requestWithoutTarget
    .normalize("NFKC")
    .replace(/\b(?:can|could|would|will)\s+you\b/gi, " ")
    .replace(/\bfor\s+me\b/gi, " ")
    .replace(/site-wide/gi, "sitewide");
  return (normalized.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])
    .filter((token) => !ignoredSearchTokens.has(token))
    .slice(0, 16)
    .join(" ")
    .slice(0, 160);
};

export const assistantSiteSearchRequestForPrompt = (
  request: string
): AssistantSiteSearchRequest | null => {
  const normalized = request.normalize("NFKC");
  if (
    normalized.length > 2_000 ||
    negativeSearchLanguage.test(normalized) ||
    !explicitSearchLanguage.test(normalized)
  ) {
    return null;
  }

  const allScopes = allScopeLanguage.test(normalized);
  const scopes = (Object.keys(scopeLanguage) as AssistantSiteSearchScope[])
    .filter((scope) => allScopes || scopeLanguage[scope].test(normalized));
  if (!scopes.length) return null;

  const query = cleanSearchQuery(normalized);
  if (query.length < 2) return null;
  return { query, scopes };
};

const prefixTsQuery = (query: string) =>
  (query.toLocaleLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])
    .slice(0, 12)
    .map((token) => `'${token.replace(/'/g, "''")}':*`)
    .join(" & ");

const siteMatches = async (
  client: PoolClient,
  owner: string,
  query: string,
  prefixQuery: string,
  limit: number
) => (await client.query<SearchRow>(
  `WITH search_query AS (
     SELECT websearch_to_tsquery('english', $1) AS exact_value,
            to_tsquery('simple', $2) AS prefix_value
   ), visible_posts AS NOT MATERIALIZED (
     SELECT post.id, post.title, post.body, post.search_text, post.revision,
            post.created_at, post.community_id
     FROM posts post
     LEFT JOIN communities community ON community.id = post.community_id
     WHERE post.deleted_at IS NULL
       AND post.room <> 'office'
       AND post.kind <> 'draft'
       AND (
         post.community_id IS NULL
         OR post.post_type = 'paper'
         OR community.visibility = 'public'
         OR post.author_handle = $3
         OR EXISTS (
           SELECT 1 FROM community_memberships viewer
           WHERE viewer.community_id = post.community_id
             AND viewer.profile_handle = $3
             AND viewer.status = 'active'
         )
       )
   ), matches AS (
     SELECT 'site'::text AS scope, 'post'::text AS "entityType", post.id AS "entityId",
            COALESCE(NULLIF(post.title, ''), 'Symposium post') AS title,
            ts_headline('english', post.body, search_query.exact_value,
              'MaxWords=70, MinWords=20, ShortWord=2') AS excerpt,
            '/posts/' || post.id AS route, post.revision, NULL::text AS "markerId",
            GREATEST(
              ts_rank_cd(to_tsvector('english', post.search_text), search_query.exact_value) * 1.2,
              ts_rank_cd(to_tsvector('simple', post.search_text), search_query.prefix_value)
            )::float AS rank,
            post.created_at
     FROM visible_posts post CROSS JOIN search_query
     WHERE to_tsvector('english', post.search_text) @@ search_query.exact_value
        OR to_tsvector('simple', post.search_text) @@ search_query.prefix_value
     UNION ALL
     SELECT 'site'::text, 'comment'::text, comment.id,
            COALESCE(NULLIF(post.title, ''), 'Comment on a Symposium post'),
            ts_headline('english', comment.body, search_query.exact_value,
              'MaxWords=70, MinWords=12, ShortWord=2'),
            '/posts/' || post.id || '?comment=' || comment.id,
            comment.revision, comment.id,
            GREATEST(
              ts_rank_cd(to_tsvector('english', comment.body), search_query.exact_value) * 1.05,
              ts_rank_cd(to_tsvector('simple', comment.body), search_query.prefix_value) * 0.9
            )::float,
            comment.created_at
     FROM comments comment
     JOIN visible_posts post ON post.id = comment.post_id
     CROSS JOIN search_query
     WHERE comment.deleted_at IS NULL
       AND (to_tsvector('english', comment.body) @@ search_query.exact_value
         OR to_tsvector('simple', comment.body) @@ search_query.prefix_value)
   )
   SELECT scope, "entityType", "entityId", title, excerpt, route, revision, rank, "markerId"
   FROM matches
   ORDER BY rank DESC, created_at DESC, "entityId" DESC
   LIMIT $4`,
  [query, prefixQuery, owner, limit]
)).rows;

const officeMatches = async (
  client: PoolClient,
  owner: string,
  prefixQuery: string,
  limit: number
) => (await client.query<SearchRow>(
  `WITH search_query AS (
     SELECT to_tsquery('simple', $1) AS prefix_value
   ), visible_notes AS NOT MATERIALIZED (
     SELECT DISTINCT note.id, note.title, note.body, note.revision, note.updated_at
     FROM notes note
     LEFT JOIN workspace_note_grants direct
       ON direct.note_id = note.id AND direct.grantee_handle = $2
     LEFT JOIN workspace_notebook_grants inherited
       ON inherited.notebook_id = note.notebook_id AND inherited.grantee_handle = $2
     WHERE note.deleted_at IS NULL
       AND (note.owner_handle = $2 OR direct.id IS NOT NULL OR inherited.id IS NOT NULL)
   )
   SELECT 'office'::text AS scope, 'note'::text AS "entityType", note.id::text AS "entityId",
          COALESCE(NULLIF(note.title, ''), 'Untitled Office note') AS title,
          ts_headline('simple', note.body, search_query.prefix_value,
            'MaxWords=80, MinWords=20, ShortWord=2') AS excerpt,
          '/workspace?view=notes&note=' || note.id::text AS route,
          note.revision, NULL::text AS "markerId",
          ts_rank_cd(
            to_tsvector('simple', COALESCE(note.title, '') || ' ' || COALESCE(note.body, '')),
            search_query.prefix_value
          )::float AS rank
   FROM visible_notes note CROSS JOIN search_query
   WHERE to_tsvector('simple', COALESCE(note.title, '') || ' ' || COALESCE(note.body, ''))
         @@ search_query.prefix_value
   ORDER BY rank DESC, note.updated_at DESC, note.id DESC
   LIMIT $3`,
  [prefixQuery, owner, limit]
)).rows;

const messageMatches = async (
  client: PoolClient,
  owner: string,
  query: string,
  limit: number
) => (await client.query<SearchRow>(
  `WITH search_query AS (
     SELECT websearch_to_tsquery('english', $1) AS exact_value
   ), visible_messages AS NOT MATERIALIZED (
     SELECT message.id, message.conversation_id, message.body, message.revision,
            message.created_at, conversation.title, conversation.kind
     FROM messages message
     JOIN conversations conversation ON conversation.id = message.conversation_id
     JOIN conversation_participants viewer
       ON viewer.conversation_id = message.conversation_id
      AND viewer.profile_handle = $2
     WHERE viewer.hidden_at IS NULL
       AND viewer.status <> 'invited'
       AND message.sequence > viewer.cleared_through_sequence
       AND (viewer.removed_through_sequence IS NULL OR message.sequence <= viewer.removed_through_sequence)
       AND message.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM message_hidden_for hidden
         WHERE hidden.message_id = message.id AND hidden.profile_handle = $2
       )
       AND (
         conversation.kind <> 'direct'
         OR NOT EXISTS (
           SELECT 1
           FROM conversation_participants other
           JOIN profile_blocks blocked
             ON (blocked.blocker_handle = $2 AND blocked.blocked_handle = other.profile_handle)
             OR (blocked.blocked_handle = $2 AND blocked.blocker_handle = other.profile_handle)
           WHERE other.conversation_id = conversation.id
             AND other.profile_handle <> $2
         )
       )
   )
   , matches AS (
     SELECT 'messages'::text AS scope, 'message'::text AS "entityType",
            message.id::text AS "entityId",
            COALESCE(NULLIF(message.title, ''),
              CASE WHEN message.kind = 'direct' THEN 'Direct message' ELSE 'Group conversation' END) AS title,
            ts_headline('english', message.body, search_query.exact_value,
              'MaxWords=70, MinWords=12, ShortWord=2') AS excerpt,
            '/messages?conversation=' || message.conversation_id::text || '#message-' || message.id::text AS route,
            message.revision, message.id::text AS "markerId",
            ts_rank_cd(to_tsvector('english', message.body), search_query.exact_value)::float AS rank,
            message.created_at
     FROM visible_messages message CROSS JOIN search_query
     WHERE to_tsvector('english', message.body) @@ search_query.exact_value
     UNION ALL
     SELECT 'messages'::text, 'assistant_message'::text, assistant_message.id::text,
            COALESCE(NULLIF(assistant_chat.title, ''), 'Assistant chat'),
            left(assistant_message.body, 1000),
            '/assistant/threads/' || assistant_chat.id::text,
            NULL::int, NULL::text,
            (similarity(assistant_message.body, $1) *
              CASE WHEN assistant_message.role = 'user' THEN 1.05 ELSE 0.95 END)::float,
            assistant_message.created_at
     FROM ai_messages assistant_message
     JOIN ai_conversations assistant_chat
       ON assistant_chat.id = assistant_message.conversation_id
     WHERE assistant_chat.owner_handle = $2
       AND assistant_chat.kind = 'research_thread'
       AND assistant_chat.deleted_at IS NULL
       AND assistant_message.role IN ('user', 'assistant')
       AND assistant_message.body ILIKE '%' || $1 || '%'
   )
   SELECT scope, "entityType", "entityId", title, excerpt, route, revision, "markerId", rank
   FROM matches
   ORDER BY rank DESC, created_at DESC, "entityId" DESC
   LIMIT $3`,
  [query, owner, limit]
)).rows;

const searchRowContext = (row: SearchRow): AssistantContextContract => {
  const excerpt = row.excerpt
    .replace(/<\/?b>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
  const content = row.entityType === "comment" && row.markerId
    ? `[Comment ${row.markerId}]\n${excerpt}`
    : row.entityType === "message" && row.markerId
      ? `[Message ${row.markerId}]\n${excerpt}`
      : excerpt;
  const revision = Number(row.revision);
  return {
    surface: row.scope === "site" ? "search" : row.scope === "office" ? "workspace" : "messages",
    route: row.route.slice(0, 500),
    title: row.title.trim().slice(0, 300),
    summary: `On-demand ${row.scope} search result`,
    content,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: {
      searchScope: row.scope,
      ephemeral: true,
      ...(Number.isInteger(revision) && revision > 0 ? { revision } : {})
    }
  };
};

export const searchAssistantSite = async (
  client: PoolClient,
  owner: string,
  request: AssistantSiteSearchRequest,
  limit: number
): Promise<AssistantContextContract[]> => {
  const boundedLimit = Math.max(0, Math.min(5, limit));
  const prefixQuery = prefixTsQuery(request.query);
  if (!boundedLimit || !prefixQuery) return [];

  const perScopeLimit = Math.min(5, Math.max(2, boundedLimit));
  const resultSets = await Promise.all(request.scopes.map((scope) => {
    if (scope === "site") return siteMatches(client, owner, request.query, prefixQuery, perScopeLimit);
    if (scope === "office") return officeMatches(client, owner, prefixQuery, perScopeLimit);
    return messageMatches(client, owner, request.query, perScopeLimit);
  }));

  const rows = resultSets.flat().sort((left, right) => Number(right.rank) - Number(left.rank));
  const contexts = rows.slice(0, boundedLimit).map(searchRowContext);
  if (contexts.length) return contexts;
  return [{
    surface: "search",
    route: `/search?q=${encodeURIComponent(request.query)}`.slice(0, 500),
    title: `No authorized matches for “${request.query}”`.slice(0, 300),
    summary: "Bounded on-demand Symposium search completed with no matching results.",
    content: `The bounded on-demand search across ${request.scopes.join(", ")} returned no authorized matches for “${request.query}”.`,
    entityType: "search",
    metadata: {
      searchScope: request.scopes.join(","),
      ephemeral: true
    }
  }];
};
