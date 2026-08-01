"use client";

import { useCallback, useEffect, useState } from "react";
import { useCrossTabItemTransport } from "@/features/live-sync/useCrossTabItemTransport";
import type { WorkspaceGrantRoleContract } from "@/packages/contracts/src";
import type {
  WorkspaceAccessOverview,
  WorkspaceDirectGrant
} from "@/lib/workspaceTypes";
import {
  workspaceGateway,
  type WorkspaceAccessTarget
} from "@/features/workspace/workspaceGateway";

export type { WorkspaceAccessTarget } from "@/features/workspace/workspaceGateway";

type WorkspaceChangeMessage = {
  type: "workspace-change";
  actorHandle: string;
  sourceId: string;
  changedAt: string;
};

const isWorkspaceChangeMessage = (value: unknown): value is WorkspaceChangeMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<WorkspaceChangeMessage>;
  return message.type === "workspace-change" &&
    typeof message.actorHandle === "string" &&
    typeof message.sourceId === "string";
};

const messageForError = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export const useWorkspaceAccess = (
  target: WorkspaceAccessTarget | null,
  actorHandle: string,
  onChanged: () => void | Promise<void>,
  onLostAccess: () => void
) => {
  const [access, setAccess] = useState<WorkspaceAccessOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!target) return null;
    if (!quiet) setLoading(true);
    try {
      const next = await workspaceGateway.getAccess(actorHandle, target);
      setAccess(next);
      setError(null);
      return next;
    } catch (caught) {
      setError(messageForError(caught, "Access settings could not be loaded."));
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [actorHandle, target]);

  useEffect(() => {
    setAccess(null);
    setError(null);
    setStatus("");
    if (target) void refresh();
  }, [refresh, target]);

  useCrossTabItemTransport<WorkspaceChangeMessage>({
    channelName: "symposium-workspace-sync-v1",
    storageKey: "symposium-cross-tab-workspace",
    isMessage: isWorkspaceChangeMessage,
    onMessage: (message) => {
      if (message.actorHandle === actorHandle) void refresh(true);
    }
  });

  useEffect(() => {
    if (!target) return;
    const handleChange = () => void refresh(true);
    window.addEventListener("symposium-workspace-change", handleChange);
    return () => window.removeEventListener("symposium-workspace-change", handleChange);
  }, [refresh, target]);

  const invite = useCallback(async (granteeHandle: string, role: WorkspaceGrantRoleContract) => {
    if (!target) return null;
    setBusy(true);
    setStatus("Sharing…");
    setError(null);
    try {
      const result = await workspaceGateway.grantAccess(actorHandle, target, granteeHandle, role);
      setAccess(result.access);
      setStatus("Access granted");
      await onChanged();
      return result.access;
    } catch (caught) {
      setError(messageForError(caught, "This participant could not be invited."));
      setStatus("");
      return null;
    } finally {
      setBusy(false);
    }
  }, [actorHandle, onChanged, target]);

  const updateRole = useCallback(async (
    granteeHandle: string,
    grant: WorkspaceDirectGrant,
    role: WorkspaceGrantRoleContract
  ) => {
    if (!target || grant.role === role) return access;
    setBusy(true);
    setStatus("Updating access…");
    setError(null);
    try {
      const result = await workspaceGateway.updateAccess(
        actorHandle,
        target,
        granteeHandle,
        grant,
        role
      );
      setAccess(result.access);
      setStatus("Access updated");
      await onChanged();
      return result.access;
    } catch (caught) {
      setError(messageForError(caught, "This access setting could not be updated."));
      setStatus("");
      return null;
    } finally {
      setBusy(false);
    }
  }, [access, actorHandle, onChanged, target]);

  const remove = useCallback(async (granteeHandle: string, grant: WorkspaceDirectGrant) => {
    if (!target) return false;
    setBusy(true);
    setStatus(granteeHandle === actorHandle ? "Leaving…" : "Removing access…");
    setError(null);
    try {
      const result = await workspaceGateway.revokeAccess(actorHandle, target, granteeHandle, grant);
      setAccess(result.access);
      await onChanged();
      if (!result.access) onLostAccess();
      else setStatus("Access removed");
      return true;
    } catch (caught) {
      setError(messageForError(caught, "This access could not be removed."));
      setStatus("");
      return false;
    } finally {
      setBusy(false);
    }
  }, [actorHandle, onChanged, onLostAccess, target]);

  const searchPeople = useCallback(async (query: string) => {
    return workspaceGateway.searchCollaborators(actorHandle, query);
  }, [actorHandle]);

  return { access, loading, busy, status, error, refresh, invite, updateRole, remove, searchPeople };
};
