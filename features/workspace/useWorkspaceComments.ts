"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClientMutationId, symposiumApi } from "@/features/api/symposiumApiClient";
import { useCrossTabItemTransport } from "@/features/live-sync/useCrossTabItemTransport";
import type { ViewActionOptions } from "@/features/actions/actionTypes";
import type { InquiryAttachment, InquiryComment } from "@/lib/mockData";
import { commentActionActive, findCommentInTree } from "@/lib/symposiumCore";
import type { VersionedDocumentContract } from "@/packages/contracts/src";
import { reconcileWorkspaceComments } from "@/features/workspace/workspaceCommentState";

type WorkspaceCommentResponse = {
  comments: InquiryComment[];
  comment?: InquiryComment;
  active?: boolean;
};

type WorkspaceDiscussionChangeMessage = {
  type: "workspace-discussion-change";
  actorHandle: string;
  noteId: string;
  sourceId: string;
  changedAt: string;
};

type WorkspaceSnapshotChangeMessage = {
  type: "workspace-change";
  actorHandle: string;
  sourceId: string;
  changedAt: string;
};

const isWorkspaceDiscussionChangeMessage = (value: unknown): value is WorkspaceDiscussionChangeMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<WorkspaceDiscussionChangeMessage>;
  return message.type === "workspace-discussion-change" &&
    typeof message.actorHandle === "string" &&
    typeof message.noteId === "string" &&
    typeof message.sourceId === "string";
};

const isWorkspaceSnapshotChangeMessage = (value: unknown): value is WorkspaceSnapshotChangeMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<WorkspaceSnapshotChangeMessage>;
  return message.type === "workspace-change" &&
    typeof message.actorHandle === "string" &&
    typeof message.sourceId === "string";
};

export const useWorkspaceComments = (noteId: string, actorHandle: string) => {
  const [comments, setComments] = useState<InquiryComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Opening draft discussion…");
  const [error, setError] = useState<string | null>(null);
  const sourceIdRef = useRef(createClientMutationId("workspace-discussion-tab"));
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  const applyComments = useCallback((incoming: InquiryComment[]) => {
    const reconciled = reconcileWorkspaceComments(commentsRef.current, incoming);
    commentsRef.current = reconciled;
    setComments(reconciled);
    return reconciled;
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setStatus("Synchronising draft discussion…");
    try {
      const result = await symposiumApi.request<WorkspaceCommentResponse>(
        `/api/workspace/documents/${encodeURIComponent(noteId)}/comments?actorHandle=${encodeURIComponent(actorHandle)}`,
        { cache: "no-store" }
      );
      const reconciled = applyComments(result.comments);
      setError(null);
      setStatus("Draft discussion current");
      return reconciled;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Draft discussion could not be loaded.";
      setError(message);
      setStatus(message);
      throw caught;
    } finally {
      setLoading(false);
    }
  }, [actorHandle, applyComments, noteId]);

  const publishChange = useCrossTabItemTransport<WorkspaceDiscussionChangeMessage>({
    channelName: "symposium-workspace-discussion-sync-v1",
    storageKey: "symposium-cross-tab-workspace-discussion",
    isMessage: isWorkspaceDiscussionChangeMessage,
    onMessage: (message) => {
      if (message.actorHandle !== actorHandle || message.noteId !== noteId || message.sourceId === sourceIdRef.current) return;
      void refresh(true).catch(() => undefined);
    }
  });

  const publishSnapshotChange = useCrossTabItemTransport<WorkspaceSnapshotChangeMessage>({
    channelName: "symposium-workspace-sync-v1",
    storageKey: "symposium-cross-tab-workspace",
    isMessage: isWorkspaceSnapshotChangeMessage,
    onMessage: () => undefined
  });

  const announceChange = useCallback(() => {
    const changedAt = new Date().toISOString();
    publishChange({
      type: "workspace-discussion-change",
      actorHandle,
      noteId,
      sourceId: sourceIdRef.current,
      changedAt
    });
    publishSnapshotChange({
      type: "workspace-change",
      actorHandle,
      sourceId: sourceIdRef.current,
      changedAt
    });
    window.dispatchEvent(new Event("symposium-workspace-change"));
  }, [actorHandle, noteId, publishChange, publishSnapshotChange]);

  useEffect(() => {
    commentsRef.current = [];
    setComments([]);
    setLoading(true);
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    const handleLiveChange = () => void refresh(true).catch(() => undefined);
    window.addEventListener("symposium-workspace-change", handleLiveChange);
    return () => window.removeEventListener("symposium-workspace-change", handleLiveChange);
  }, [refresh]);

  const commit = useCallback((result: WorkspaceCommentResponse, nextStatus: string) => {
    applyComments(result.comments);
    setError(null);
    setStatus(nextStatus);
    announceChange();
    return result;
  }, [announceChange, applyComments]);

  const addComment = useCallback(async (
    _itemId: string,
    body: string,
    document: VersionedDocumentContract,
    stance: string,
    parentId: string | null,
    attachments: InquiryAttachment[]
  ) => {
    setStatus(parentId ? "Saving reply…" : "Saving comment…");
    try {
      const result = await symposiumApi.request<WorkspaceCommentResponse>(
        `/api/workspace/documents/${encodeURIComponent(noteId)}/comments`,
        {
          method: "POST",
          idempotencyKey: createClientMutationId(parentId ? "workspace-comment-reply" : "workspace-comment-create"),
          body: {
            actorHandle,
            body,
            document,
            stance,
            parentId,
            attachmentIds: attachments.map((attachment) => attachment.id)
          }
        }
      );
      commit(result, parentId ? "Reply saved" : "Comment saved");
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Comment could not be saved.";
      setError(message);
      setStatus(message);
      return false;
    }
  }, [actorHandle, commit, noteId]);

  const updateComment = useCallback(async (
    comment: InquiryComment,
    body: string,
    document: VersionedDocumentContract,
    attachments: InquiryAttachment[]
  ) => {
    if (!comment.id) throw new Error("Comment not found.");
    setStatus("Saving comment edit…");
    const result = await symposiumApi.request<WorkspaceCommentResponse>(
      `/api/workspace/documents/${encodeURIComponent(noteId)}/comments/${encodeURIComponent(comment.id)}`,
      {
        method: "PATCH",
        idempotencyKey: createClientMutationId("workspace-comment-update"),
        body: {
          actorHandle,
          body,
          document,
          expectedRevision: comment.revision ?? 1,
          attachmentIds: attachments.map((attachment) => attachment.id)
        }
      }
    );
    return commit(result, "Comment edited");
  }, [actorHandle, commit, noteId]);

  const deleteComment = useCallback(async (commentId: string) => {
    const comment = findCommentInTree(commentsRef.current, commentId);
    if (!comment) throw new Error("Comment not found.");
    setStatus("Deleting comment…");
    const result = await symposiumApi.request<WorkspaceCommentResponse>(
      `/api/workspace/documents/${encodeURIComponent(noteId)}/comments/${encodeURIComponent(commentId)}`,
      {
        method: "DELETE",
        idempotencyKey: createClientMutationId("workspace-comment-delete"),
        body: { actorHandle, expectedRevision: comment.revision ?? 1 }
      }
    );
    return commit(result, "Comment deleted");
  }, [actorHandle, commit, noteId]);

  const applyAction = useCallback((
    _itemId: string,
    commentId: string,
    action: "signal" | "save" | "read" | "fork",
    options?: ViewActionOptions
  ) => {
    if (action === "fork") return;
    const comment = findCommentInTree(commentsRef.current, commentId);
    if (!comment) return;
    const active = action === "read" ? undefined : !commentActionActive(comment, action, actorHandle);
    void symposiumApi.request<WorkspaceCommentResponse>(
      `/api/workspace/documents/${encodeURIComponent(noteId)}/comments/${encodeURIComponent(commentId)}/actions`,
      {
        method: "POST",
        idempotencyKey: createClientMutationId(`workspace-comment-${action}`),
        body: { actorHandle, action, active, trigger: options?.trigger, surface: "workspace" }
      }
    ).then((result) => commit(result, action === "read" ? "Draft discussion current" : "Comment action saved"))
      .catch((caught) => {
        const message = caught instanceof Error ? caught.message : "Comment action could not be saved.";
        setError(message);
        setStatus(message);
      });
  }, [actorHandle, commit, noteId]);

  return useMemo(() => ({
    comments,
    loading,
    status,
    error,
    refresh,
    addComment,
    updateComment,
    deleteComment,
    applyAction,
    setError
  }), [comments, loading, status, error, refresh, addComment, updateComment, deleteComment, applyAction]);
};
