"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  Ellipsis,
  LoaderCircle,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
  X
} from "lucide-react";
import type { AssistantThreadSummaryContract } from "@/packages/contracts/src";
import { assistantThreadActivityLabel } from "@/features/assistant/assistantThreadOrdering";

type ThreadHistoryItemMode = "closed" | "menu" | "rename" | "delete";

export function AssistantThreadHistoryItem({
  candidate,
  selected,
  disabled,
  busy,
  onSelect,
  onUpdate,
  onDelete
}: {
  candidate: AssistantThreadSummaryContract;
  selected: boolean;
  disabled: boolean;
  busy: boolean;
  onSelect: () => void;
  onUpdate: (changes: {
    title?: string;
    pinned?: boolean;
    archived?: boolean;
  }) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [itemMode, setItemMode] =
    useState<ThreadHistoryItemMode>("closed");
  const [title, setTitle] = useState(candidate.title);
  const rootRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setTitle(candidate.title);
  }, [candidate.title]);

  useEffect(() => {
    if (itemMode === "closed") return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setItemMode("closed");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setItemMode("closed");
        window.requestAnimationFrame(() => moreButtonRef.current?.focus());
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [itemMode]);

  useEffect(() => {
    if (itemMode !== "rename") return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [itemMode]);

  useEffect(() => {
    if (itemMode === "delete") deleteCancelRef.current?.focus();
  }, [itemMode]);

  const closeActions = () => {
    setItemMode("closed");
    window.requestAnimationFrame(() => moreButtonRef.current?.focus());
  };

  const runUpdate = async (changes: {
    title?: string;
    pinned?: boolean;
    archived?: boolean;
  }) => {
    const updated = await onUpdate(changes);
    if (updated) closeActions();
  };

  return (
    <div
      className={`assistant-thread-item${selected ? " active" : ""}${
        candidate.pinned ? " pinned" : ""
      }`}
      data-assistant-thread-id={candidate.id}
      ref={rootRef}
    >
      <button
        type="button"
        className="assistant-thread-select"
        aria-current={selected ? "page" : undefined}
        onClick={() => {
          setItemMode("closed");
          onSelect();
        }}
      >
        <strong>
          {candidate.pinned ? <Pin size={11} aria-label="Pinned" /> : null}
          {candidate.title}
        </strong>
        <span>
          {candidate.sourceCount} source
          {candidate.sourceCount === 1 ? "" : "s"}
        </span>
        <time dateTime={candidate.lastMessageAt}>
          {assistantThreadActivityLabel(candidate.lastMessageAt)}
        </time>
      </button>
      <button
        type="button"
        className="assistant-thread-more"
        ref={moreButtonRef}
        aria-label={`Manage ${candidate.title}`}
        aria-haspopup="menu"
        aria-expanded={itemMode !== "closed"}
        disabled={disabled}
        onClick={() =>
          setItemMode((current) =>
            current === "closed" ? "menu" : "closed"
          )
        }
      >
        {busy ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          <Ellipsis size={15} />
        )}
      </button>

      {itemMode !== "closed" ? (
        <div
          className={`assistant-thread-popover ${itemMode}`}
          role={
            itemMode === "menu"
              ? "menu"
              : itemMode === "delete"
                ? "alertdialog"
                : "dialog"
          }
          aria-label={
            itemMode === "menu"
              ? `Chat actions for ${candidate.title}`
              : undefined
          }
        >
          {itemMode === "menu" ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => setItemMode("rename")}
              >
                <Pencil size={13} />
                Rename
              </button>
              {!candidate.archivedAt ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    void runUpdate({ pinned: !candidate.pinned })
                  }
                >
                  {candidate.pinned ? (
                    <PinOff size={13} />
                  ) : (
                    <Pin size={13} />
                  )}
                  {candidate.pinned ? "Unpin" : "Pin"}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                onClick={() =>
                  void runUpdate({
                    archived: candidate.archivedAt === null
                  })
                }
              >
                {candidate.archivedAt ? (
                  <RotateCcw size={13} />
                ) : (
                  <Archive size={13} />
                )}
                {candidate.archivedAt ? "Restore" : "Archive"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => setItemMode("delete")}
              >
                <Trash2 size={13} />
                Delete
              </button>
            </>
          ) : itemMode === "rename" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const normalized = title.trim();
                if (!normalized || normalized === candidate.title) {
                  closeActions();
                  return;
                }
                void runUpdate({ title: normalized });
              }}
            >
              <label htmlFor={`assistant-thread-title-${candidate.id}`}>
                Rename chat
              </label>
              <input
                id={`assistant-thread-title-${candidate.id}`}
                ref={renameInputRef}
                value={title}
                maxLength={300}
                onChange={(event) => setTitle(event.target.value)}
              />
              <span>
                <button type="button" onClick={closeActions}>
                  <X size={13} />
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={!title.trim()}
                >
                  <Check size={13} />
                  Save
                </button>
              </span>
            </form>
          ) : (
            <>
              <strong>Delete this chat permanently?</strong>
              <p>
                Its messages and saved context will be removed. Office notes
                already saved from it will remain.
              </p>
              <span>
                <button
                  type="button"
                  ref={deleteCancelRef}
                  onClick={closeActions}
                >
                  Keep chat
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    void onDelete().then((deleted) => {
                      if (deleted) closeActions();
                    });
                  }}
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
