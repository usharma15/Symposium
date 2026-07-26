import type { DocumentSourceSnapshotContract } from "@/packages/contracts/src";

export type AssistantEvidenceCitationForAuthoring = {
  title: string;
  excerpt: string;
  route: string;
  kind: string;
  entityType?: string;
  entityId?: string;
};

export const nativeSourceForAssistantCitation = (
  citation: AssistantEvidenceCitationForAuthoring
): DocumentSourceSnapshotContract | null => {
  try {
    const url = new URL(citation.route || "/", "https://symposium.invalid");
    const segments = url.pathname.split("/").filter(Boolean);
    const routePostId = segments[0] === "posts" ? decodeURIComponent(segments[1] ?? "") : "";
    const routeCommentId = url.searchParams.get("comment")?.trim() ?? "";
    const routeAttachmentId = url.searchParams.get("attachment")?.trim() ?? "";

    if (citation.kind === "comment" || citation.entityType === "comment") {
      const commentId = citation.entityType === "comment"
        ? citation.entityId?.trim() || routeCommentId
        : routeCommentId;
      if (!commentId || !routePostId) return null;
      return {
        kind: "comment",
        sourceId: commentId,
        sourcePostId: routePostId,
        sourceCommentId: commentId,
        title: citation.title,
        body: citation.excerpt,
        canonicalPath: `${url.pathname}${url.search}`
      };
    }

    if (citation.entityType === "attachment") {
      const attachmentId = citation.entityId?.trim() || routeAttachmentId;
      if (!attachmentId || !routePostId) return null;
      return {
        kind: "attachment",
        sourceId: attachmentId,
        sourcePostId: routePostId,
        ...(routeCommentId ? { sourceCommentId: routeCommentId } : {}),
        title: citation.title,
        body: citation.excerpt,
        canonicalPath: `${url.pathname}${url.search}`
      };
    }

    if (
      citation.entityType &&
      citation.entityType !== "post" &&
      citation.entityType !== "opportunity"
    ) {
      return null;
    }
    const postId = citation.entityId?.trim() || routePostId;
    if (!postId) return null;
    return {
      kind: "post",
      sourceId: postId,
      sourcePostId: postId,
      title: citation.title,
      body: citation.excerpt,
      canonicalPath: `${url.pathname}${url.search}${url.hash}`
    };
  } catch {
    return null;
  }
};
