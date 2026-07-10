"use client";

import { MessageCircle, X } from "lucide-react";
import { profileInitials as initial } from "@/features/identity/profilePresentation";

export function MessagesModal({ onClose }: { onClose: () => void }) {
  const threads = [
    {
      name: "AI Metascience Lab",
      type: "Group",
      preview: "Mira shared the benchmark notes for tomorrow's review.",
      time: "12m"
    },
    {
      name: "Niko Varga",
      type: "Direct",
      preview: "Can you look over the hidden-law task stub?",
      time: "31m"
    },
    {
      name: "Campus Events Board",
      type: "Group",
      preview: "Office hours moved to the civic patronage table.",
      time: "1h"
    },
    {
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
            <button className="message-thread" type="button" key={`${thread.type}-${thread.name}`}>
              <span className="avatar small">{initial(thread.name)}</span>
              <span>
                <strong>{thread.name}</strong>
                <small>
                  {thread.type} · {thread.time}
                </small>
                <em>{thread.preview}</em>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
