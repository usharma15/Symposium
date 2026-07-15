"use client";

import { MessageCircle, X } from "lucide-react";
import { profileInitials as initial } from "@/features/identity/profilePresentation";
import { CanonicalLink } from "@/features/navigation/CanonicalLink";

export function MessagesModal({
  activeConversationId,
  onClose,
  onOpenConversation
}: {
  activeConversationId: string | null;
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
}) {
  const threads = [
    {
      id: "ai-metascience-lab",
      name: "AI Metascience Lab",
      type: "Group",
      preview: "Mira shared the benchmark notes for tomorrow's review.",
      time: "12m"
    },
    {
      id: "niko-varga",
      name: "Niko Varga",
      type: "Direct",
      preview: "Can you look over the hidden-law task stub?",
      time: "31m"
    },
    {
      id: "campus-events-board",
      name: "Campus Events Board",
      type: "Group",
      preview: "Office hours moved to the public patronage table.",
      time: "1h"
    },
    {
      id: "salma-idris",
      name: "Salma Idris",
      type: "Direct",
      preview: "The youth-lab call notes are ready when you are.",
      time: "3h"
    }
  ];

  return (
    <div className="modal-backdrop messages-backdrop" role="presentation" onClick={onClose}>
      <section className="messages-modal" aria-label="Messages" onClick={(event) => event.stopPropagation()}>
        <header>
          <span>
            <MessageCircle size={18} />
            Messages
          </span>
          <button type="button" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        <div className="message-list">
          {threads.map((thread) => (
            <CanonicalLink
              className={`message-thread ${activeConversationId === thread.id ? "active" : ""}`}
              key={thread.id}
              route={{ kind: "messages", conversationId: thread.id }}
              onNavigate={() => onOpenConversation(thread.id)}
              aria-current={activeConversationId === thread.id ? "page" : undefined}
            >
              <span className="avatar small">{initial(thread.name)}</span>
              <span>
                <strong>{thread.name}</strong>
                <small>
                  {thread.type} · {thread.time}
                </small>
                <em>{thread.preview}</em>
              </span>
            </CanonicalLink>
          ))}
        </div>
      </section>
    </div>
  );
}
