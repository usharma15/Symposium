type PostAlias = "post";
type CommentAlias = "comment";

const selectColumns = (
  alias: PostAlias | CommentAlias | undefined,
  columns: readonly string[]
) => {
  const qualifier = alias ? `${alias}.` : "";
  return columns.map((column) => `${qualifier}${column}`).join(",\n");
};

const postColumns = [
  "id", "revision", "kind", 'post_type AS "postType"', "room",
  'community_id AS "communityId"', "title", 'author_handle AS "authorHandle"',
  'author_name AS "authorName"', "affiliation", 'date_label AS "dateLabel"',
  'created_at AS "createdAt"', 'edited_at AS "editedAt"', 'deleted_at AS "deletedAt"',
  "status", "metrics", 'gathering_reason AS "gatheringReason"', "excerpt", "body",
  'content_document AS "document"', "tags", "signals", "claims", "objections", "evidence",
  "tests", "forks", "saved", 'saved_by AS "savedBy"', 'signaled_by AS "signaledBy"',
  'forked_by AS "forkedBy"', "quote", "patronage", "opportunity",
  'design_assignment AS "designAssignment"'
] as const;

const commentColumns = [
  "id", "revision", 'post_id AS "postId"', 'parent_id AS "parentId"',
  'author_handle AS "authorHandle"', 'author_name AS "authorName"', "stance", "body",
  'content_document AS "document"', "metrics", 'saved_by AS "savedBy"',
  'signaled_by AS "signaledBy"', 'forked_by AS "forkedBy"', "quote",
  'edited_at AS "editedAt"', 'deleted_at AS "deletedAt"', 'created_at AS "createdAt"'
] as const;

export const postSelectColumns = (alias?: PostAlias) => selectColumns(alias, postColumns);
export const commentSelectColumns = (alias?: CommentAlias) => selectColumns(alias, commentColumns);
