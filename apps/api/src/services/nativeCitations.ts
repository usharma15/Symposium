import { TRPCError } from "@trpc/server";
import type { PoolClient } from "pg";
import {
  attachmentKindForFile,
  documentPlainTextProjection,
  versionedDocumentSchema,
  type DocumentNativeCitationContract,
  type DocumentSourceSnapshotContract,
  type VersionedDocumentContract
} from "../../../../packages/contracts/src";

type CitationSourceRow = {
  id: string;
  revision: number;
  authorName: string;
  authorHandle: string | null;
  title: string;
  body: string;
  document: unknown;
  postId: string;
  commentId: string | null;
  postType: string;
  createdAt: Date | string;
  fileName?: string;
  contentType?: string;
  byteSize?: number;
  metadata?: Record<string, unknown>;
};

export type NativeCitationResolution = {
  document: VersionedDocumentContract;
  citationCount: number;
  newCitationCount: number;
  sourceIds: string[];
};

const postAccessSql = `
  AND post.deleted_at IS NULL
  AND ((post.room <> 'office' AND post.kind <> 'draft') OR post.author_handle = $2)
  AND (
    post.community_id IS NULL
    OR post.post_type = 'paper'
    OR community.visibility = 'public'
    OR post.author_handle = $2
    OR EXISTS (
      SELECT 1
      FROM community_memberships viewer
      WHERE viewer.community_id = post.community_id
        AND viewer.profile_handle = $2
        AND viewer.status = 'active'
    )
  )`;

const normalizedText = (value: string) => value.replace(/\s+/g, " ").trim();

const postTone = (value: string) => {
  if (value === "paper") return "paper" as const;
  if (value === "proposal") return "patronage" as const;
  if (value === "opportunity") return "opportunity" as const;
  return "thought" as const;
};

const citationRecords = (document: VersionedDocumentContract | null | undefined) => {
  const records: DocumentNativeCitationContract[] = [];
  if (!document) return records;
  for (const node of document.nodes) {
    if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") {
      node.content.forEach((run) => {
        if (run.citation) records.push(run.citation);
      });
    } else if (node.type === "list") {
      node.items.forEach((item) => item.forEach((run) => {
        if (run.citation) records.push(run.citation);
      }));
    }
  }
  return records;
};

const parsedDocument = (value: unknown) => {
  const parsed = versionedDocumentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const blockText = (
  document: VersionedDocumentContract,
  blockId: string
) => {
  const node = document.nodes.find((candidate) => candidate.id === blockId);
  if (!node) return null;
  if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") {
    return node.content.map((run) => run.text).join("");
  }
  if (node.type === "list") {
    return node.items.map((item) => item.map((run) => run.text).join("")).join("\n");
  }
  if (node.type === "code") return node.code;
  if (node.type === "equation") return node.source;
  if (node.type === "drawing") return node.caption ?? "";
  if (node.type === "attachment") return node.caption ?? "";
  if (node.type === "citation") return node.excerpt ?? node.label;
  return node.resource.label ?? "";
};

const exactDocumentExcerpt = (
  document: VersionedDocumentContract,
  locator: Extract<DocumentNativeCitationContract["locator"], { kind: "text" }>
) => {
  if (!locator.startBlockId || !locator.endBlockId) return null;
  const startIndex = document.nodes.findIndex((node) => node.id === locator.startBlockId);
  const endIndex = document.nodes.findIndex((node) => node.id === locator.endBlockId);
  if (startIndex < 0 || endIndex < startIndex) return null;
  const chunks = document.nodes.slice(startIndex, endIndex + 1).map((node) => blockText(document, node.id) ?? "");
  const first = chunks[0] ?? "";
  const last = chunks.at(-1) ?? "";
  const startOffset = locator.startOffset ?? 0;
  const endOffset = locator.endOffset ?? last.length;
  if (startOffset > first.length || endOffset > last.length) return null;
  if (chunks.length === 1) return first.slice(startOffset, endOffset);
  return [
    first.slice(startOffset),
    ...chunks.slice(1, -1),
    last.slice(0, endOffset)
  ].join("\n");
};

const metadataText = (metadata: Record<string, unknown> | undefined) => {
  if (!metadata) return "";
  const previewText = typeof metadata.previewText === "string" ? metadata.previewText : "";
  const structured = metadata.structuredPreview && typeof metadata.structuredPreview === "object"
    ? JSON.stringify(metadata.structuredPreview)
    : "";
  return `${previewText}\n${structured}`;
};

const unavailableCitation = () => {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "A cited Symposium source is unavailable or no longer accessible. Recapture the passage before saving."
  });
};

const resolveCitationSource = async (
  client: PoolClient,
  citation: DocumentNativeCitationContract,
  actorHandle: string
): Promise<{ source: DocumentSourceSnapshotContract; row: CitationSourceRow }> => {
  if (citation.source.kind === "post") {
    const result = await client.query<CitationSourceRow>(
      `SELECT
         post.id,
         post.revision,
         post.author_name AS "authorName",
         post.author_handle AS "authorHandle",
         post.title,
         post.body,
         post.content_document AS document,
         post.id AS "postId",
         NULL::text AS "commentId",
         post.post_type AS "postType",
         post.created_at AS "createdAt"
       FROM posts post
       LEFT JOIN communities community ON community.id = post.community_id
       WHERE post.id = $1
         ${postAccessSql}
       LIMIT 1`,
      [citation.source.sourceId, actorHandle]
    );
    const row = result.rows[0];
    if (!row) return unavailableCitation();
    return {
      row,
      source: {
        kind: "post",
        sourceId: row.id,
        sourcePostId: row.postId,
        sourceRevision: row.revision,
        author: row.authorName,
        ...(row.authorHandle ? { authorHandle: row.authorHandle } : {}),
        title: row.title,
        body: row.body.slice(0, 4000),
        postTone: postTone(row.postType),
        createdAt: new Date(row.createdAt).toISOString(),
        canonicalPath: `/posts/${encodeURIComponent(row.postId)}`
      }
    };
  }

  if (citation.source.kind === "comment") {
    const result = await client.query<CitationSourceRow>(
      `SELECT
         comment.id,
         comment.revision,
         comment.author_name AS "authorName",
         comment.author_handle AS "authorHandle",
         post.title,
         comment.body,
         comment.content_document AS document,
         post.id AS "postId",
         comment.id AS "commentId",
         post.post_type AS "postType",
         comment.created_at AS "createdAt"
       FROM comments comment
       JOIN posts post ON post.id = comment.post_id
       LEFT JOIN communities community ON community.id = post.community_id
       WHERE comment.id = $1
         AND comment.deleted_at IS NULL
         ${postAccessSql}
       LIMIT 1`,
      [citation.source.sourceId, actorHandle]
    );
    const row = result.rows[0];
    if (!row) return unavailableCitation();
    return {
      row,
      source: {
        kind: "comment",
        sourceId: row.id,
        sourcePostId: row.postId,
        sourceCommentId: row.id,
        sourceRevision: row.revision,
        author: row.authorName,
        ...(row.authorHandle ? { authorHandle: row.authorHandle } : {}),
        title: `Comment by ${row.authorName}`,
        body: row.body.slice(0, 4000),
        postTone: postTone(row.postType),
        createdAt: new Date(row.createdAt).toISOString(),
        canonicalPath: `/posts/${encodeURIComponent(row.postId)}?comment=${encodeURIComponent(row.id)}`
      }
    };
  }

  const result = await client.query<CitationSourceRow>(
    `SELECT
       attachment.id::text AS id,
       post.revision,
       post.author_name AS "authorName",
       post.author_handle AS "authorHandle",
       post.title,
       post.body,
       post.content_document AS document,
       post.id AS "postId",
       comment.id AS "commentId",
       post.post_type AS "postType",
       post.created_at AS "createdAt",
       attachment.file_name AS "fileName",
       attachment.content_type AS "contentType",
       attachment.byte_size AS "byteSize",
       attachment.metadata
     FROM attachments attachment
     LEFT JOIN comments comment
       ON attachment.owner_type = 'comment' AND comment.id = attachment.owner_id
     JOIN posts post
       ON post.id = CASE
         WHEN attachment.owner_type = 'post' THEN attachment.owner_id
         WHEN attachment.owner_type = 'comment' THEN comment.post_id
         ELSE NULL
       END
     LEFT JOIN communities community ON community.id = post.community_id
     WHERE attachment.id::text = $1
       AND attachment.status IN ('uploaded', 'previewed')
       AND (comment.id IS NULL OR comment.deleted_at IS NULL)
       ${postAccessSql}
     LIMIT 1`,
    [citation.source.sourceId, actorHandle]
  );
  const row = result.rows[0];
  if (!row || !row.fileName || !row.contentType || row.byteSize === undefined) return unavailableCitation();
  const canonicalPath = `/posts/${encodeURIComponent(row.postId)}${row.commentId ? `?comment=${encodeURIComponent(row.commentId)}&` : "?"}attachment=${encodeURIComponent(row.id)}`;
  return {
    row,
    source: {
      kind: "attachment",
      sourceId: row.id,
      sourcePostId: row.postId,
      ...(row.commentId ? { sourceCommentId: row.commentId } : {}),
      sourceRevision: row.revision,
      author: row.authorName,
      ...(row.authorHandle ? { authorHandle: row.authorHandle } : {}),
      title: row.fileName,
      body: `Attached to ${row.title}`.slice(0, 4000),
      postTone: postTone(row.postType),
      createdAt: new Date(row.createdAt).toISOString(),
      canonicalPath,
      attachment: {
        id: row.id,
        fileName: row.fileName,
        contentType: row.contentType,
        kind: attachmentKindForFile(row.contentType, row.fileName),
        byteSize: row.byteSize
      }
    }
  };
};

const assertCitationLocator = (
  citation: DocumentNativeCitationContract,
  row: CitationSourceRow
) => {
  const excerpt = normalizedText(citation.excerpt);
  const locator = citation.locator;
  const sourceDocument = parsedDocument(row.document);
  const sourceBody = sourceDocument ? documentPlainTextProjection(sourceDocument) : row.body;
  const attachmentText = metadataText(row.metadata);

  if (locator.kind === "text") {
    const exact = sourceDocument ? exactDocumentExcerpt(sourceDocument, locator) : null;
    const available = normalizedText(exact ?? sourceBody);
    if (!available.includes(excerpt)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "The cited passage no longer matches the selected Symposium text. Recapture it before saving."
      });
    }
    return;
  }

  const attachmentKind = row.contentType && row.fileName
    ? attachmentKindForFile(row.contentType, row.fileName)
    : null;
  if (!attachmentKind) unavailableCitation();
  if (locator.kind === "whole") return;
  if (locator.kind === "image-region") {
    if (attachmentKind !== "image") unavailableCitation();
    return;
  }
  if (locator.kind === "pdf-text") {
    if (
      attachmentKind !== "pdf" ||
      normalizedText(locator.excerpt) !== excerpt ||
      !normalizedText(attachmentText).includes(excerpt)
    ) {
      unavailableCitation();
    }
    return;
  }
  if (locator.kind === "spreadsheet-range" && attachmentKind !== "spreadsheet") unavailableCitation();
  if (locator.kind === "presentation-slide" && attachmentKind !== "presentation") unavailableCitation();
  if (!normalizedText(attachmentText).includes(excerpt)) unavailableCitation();
};

const replaceCitationRecords = (
  document: VersionedDocumentContract,
  replacements: Map<string, DocumentNativeCitationContract>
): VersionedDocumentContract => ({
  ...document,
  nodes: document.nodes.map((node) => {
    if (node.type === "paragraph" || node.type === "heading" || node.type === "quote") {
      return {
        ...node,
        content: node.content.map((run) => run.citation
          ? { ...run, citation: replacements.get(run.citation.id) ?? run.citation }
          : run)
      };
    }
    if (node.type === "list") {
      return {
        ...node,
        items: node.items.map((item) => item.map((run) => run.citation
          ? { ...run, citation: replacements.get(run.citation.id) ?? run.citation }
          : run))
      };
    }
    return node;
  })
});

export const resolveNativeDocumentCitations = async (
  client: PoolClient,
  document: VersionedDocumentContract,
  actorHandle: string,
  existingDocument?: VersionedDocumentContract | null
): Promise<NativeCitationResolution> => {
  const records = citationRecords(document);
  const existing = new Map(citationRecords(existingDocument).map((citation) => [citation.id, citation]));
  const unique = new Map<string, DocumentNativeCitationContract>();
  for (const citation of records) {
    const duplicate = unique.get(citation.id);
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(citation)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "A citation marker cannot reuse an ID for a different source."
      });
    }
    unique.set(citation.id, citation);
  }

  const replacements = new Map<string, DocumentNativeCitationContract>();
  let newCitationCount = 0;
  for (const citation of unique.values()) {
    const persisted = existing.get(citation.id);
    if (persisted) {
      if (JSON.stringify(persisted) !== JSON.stringify(citation)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A saved citation snapshot cannot be silently changed. Remove it and capture a new citation instead."
        });
      }
      replacements.set(citation.id, persisted);
      continue;
    }
    const resolved = await resolveCitationSource(client, citation, actorHandle);
    assertCitationLocator(citation, resolved.row);
    replacements.set(citation.id, {
      ...citation,
      excerpt: normalizedText(citation.excerpt),
      source: resolved.source,
      capturedAt: new Date().toISOString()
    });
    newCitationCount += 1;
  }

  return {
    document: replaceCitationRecords(document, replacements),
    citationCount: unique.size,
    newCitationCount,
    sourceIds: Array.from(new Set(Array.from(replacements.values()).map((citation) => citation.source.sourceId)))
  };
};
