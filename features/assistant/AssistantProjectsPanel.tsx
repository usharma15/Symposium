"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  Check,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X
} from "lucide-react";
import type { AssistantProjectContract } from "@/packages/contracts/src";

type ProjectMode =
  | { kind: "menu"; projectId: string }
  | { kind: "rename"; projectId: string }
  | { kind: "delete"; projectId: string }
  | null;

export function AssistantProjectsPanel({
  projects,
  selectedProjectId,
  disabled,
  busyId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  expandedContent
}: {
  projects: AssistantProjectContract[];
  selectedProjectId: string | null;
  disabled: boolean;
  busyId: string | null;
  onSelect: (projectId: string) => void;
  onCreate: (name: string) => Promise<boolean>;
  onRename: (
    project: AssistantProjectContract,
    name: string
  ) => Promise<boolean>;
  onDelete: (project: AssistantProjectContract) => Promise<boolean>;
  expandedContent: ReactNode;
}) {
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<ProjectMode>(null);
  const [name, setName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeProject = mode
    ? projects.find((project) => project.id === mode.projectId) ?? null
    : null;

  useEffect(() => {
    if (!creating && mode?.kind !== "rename") return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [creating, mode]);

  useEffect(() => {
    if (!creating && !mode) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setCreating(false);
        setMode(null);
        setName("");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setCreating(false);
      setMode(null);
      setName("");
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [creating, mode]);

  const closeEditor = () => {
    setCreating(false);
    setMode(null);
    setName("");
  };

  return (
    <section
      className="assistant-projects-panel"
      aria-label="Chat Projects"
      ref={rootRef}
    >
      <header>
        <span>
          <FolderOpen size={13} />
          <strong>Projects</strong>
        </span>
        <button
          type="button"
          aria-label="Create a Project"
          title="Create a Project"
          disabled={disabled}
          onClick={() => {
            setMode(null);
            setName("");
            setCreating(true);
          }}
        >
          {busyId === "create" ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <Plus size={13} />
          )}
        </button>
      </header>
      <small>
        Organization only. Projects never add context or consume AI answers.
      </small>

      {creating ? (
        <form
          className="assistant-project-editor"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = name.trim();
            if (!normalized) return;
            void onCreate(normalized).then((created) => {
              if (created) closeEditor();
            });
          }}
        >
          <label htmlFor="assistant-project-create-name">
            Project name
          </label>
          <input
            id="assistant-project-create-name"
            ref={inputRef}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          <span>
            <button type="button" onClick={closeEditor}>
              <X size={12} />Cancel
            </button>
            <button
              type="submit"
              className="primary"
              disabled={!name.trim() || busyId !== null}
            >
              <Check size={12} />Create
            </button>
          </span>
        </form>
      ) : null}

      <div className="assistant-project-list">
        {projects.length ? projects.map((project) => (
          <div
            className={`assistant-project-group${
              project.id === selectedProjectId ? " active" : ""
            }`}
            key={project.id}
          >
            <div className="assistant-project-item">
              <button
                type="button"
                className="assistant-project-select"
                aria-expanded={project.id === selectedProjectId}
                aria-controls={
                  project.id === selectedProjectId
                    ? `assistant-project-chats-${project.id}`
                    : undefined
                }
                onClick={() => {
                  setMode(null);
                  onSelect(project.id);
                }}
              >
                <ChevronRight
                  className={
                    project.id === selectedProjectId ? "expanded" : undefined
                  }
                  size={13}
                />
                <Folder size={13} />
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {project.activeThreadCount} active chat
                    {project.activeThreadCount === 1 ? "" : "s"}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className="assistant-project-more"
                aria-label={`Manage Project ${project.name}`}
                aria-haspopup="menu"
                aria-expanded={mode?.projectId === project.id}
                disabled={disabled}
                onClick={() => {
                  setCreating(false);
                  setName("");
                  setMode((current) =>
                    current?.projectId === project.id
                      ? null
                      : { kind: "menu", projectId: project.id }
                  );
                }}
              >
                {busyId === project.id ? (
                  <LoaderCircle className="spin" size={13} />
                ) : (
                  <Ellipsis size={14} />
                )}
              </button>
            </div>
            {mode?.projectId === project.id ? (
              <div
                className={`assistant-project-popover ${mode.kind}`}
                role={
                  mode.kind === "menu"
                    ? "menu"
                    : mode.kind === "delete"
                      ? "alertdialog"
                      : "dialog"
                }
                aria-label={
                  mode.kind === "menu"
                    ? `Project actions for ${project.name}`
                    : mode.kind === "delete"
                      ? `Delete Project ${project.name}`
                      : `Rename Project ${project.name}`
                }
              >
                {mode.kind === "menu" ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setName(project.name);
                        setMode({
                          kind: "rename",
                          projectId: project.id
                        });
                      }}
                    >
                      <Pencil size={12} />Rename
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="danger"
                      onClick={() => setMode({
                        kind: "delete",
                        projectId: project.id
                      })}
                    >
                      <Trash2 size={12} />Delete Project
                    </button>
                  </>
                ) : mode.kind === "rename" ? (
                  <form
                    className="assistant-project-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const normalized = name.trim();
                      if (!normalized) return;
                      if (normalized === project.name) {
                        closeEditor();
                        return;
                      }
                      void onRename(project, normalized).then((renamed) => {
                        if (renamed) closeEditor();
                      });
                    }}
                  >
                    <label htmlFor={`assistant-project-name-${project.id}`}>
                      Rename Project
                    </label>
                    <input
                      id={`assistant-project-name-${project.id}`}
                      ref={inputRef}
                      value={name}
                      maxLength={120}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <span>
                      <button type="button" onClick={closeEditor}>
                        <X size={12} />Cancel
                      </button>
                      <button
                        type="submit"
                        className="primary"
                        disabled={!name.trim() || busyId !== null}
                      >
                        <Check size={12} />Save
                      </button>
                    </span>
                  </form>
                ) : (
                  <>
                    <strong>Delete {project.name}?</strong>
                    <p>
                      Its chats return to All. No chat, source, or Office
                      document is deleted.
                    </p>
                    <span>
                      <button type="button" onClick={closeEditor}>
                        Keep Project
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={busyId !== null}
                        onClick={() => {
                          void onDelete(project).then((deleted) => {
                            if (deleted) closeEditor();
                          });
                        }}
                      >
                        <Trash2 size={12} />Delete
                      </button>
                    </span>
                  </>
                )}
              </div>
            ) : null}
            {project.id === selectedProjectId ? (
              <div
                className="assistant-project-chats"
                id={`assistant-project-chats-${project.id}`}
                aria-label={`${project.name} active chats`}
              >
                {expandedContent}
              </div>
            ) : null}
          </div>
        )) : (
          <p>
            No Projects yet. Create one to group related chats.
          </p>
        )}
      </div>
      {activeProject && mode?.kind === "delete" ? (
        <span className="sr-only" aria-live="polite">
          Deleting {activeProject.name} will not delete its chats.
        </span>
      ) : null}
    </section>
  );
}
