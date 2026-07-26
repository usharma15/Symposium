import type { ReactNode } from "react";

const assistantInlineContent = (
  value: string,
  keyPrefix: string
): ReactNode[] =>
  value
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
    .filter(Boolean)
    .map((part, index) => {
      const key = `${keyPrefix}:${index}`;
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={key}>{part.slice(1, -1)}</code>;
      }
      return part;
    });

export function AssistantMessageBody({ body }: { body: string }) {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (!line) {
      index += 1;
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const orderedList = Boolean(ordered);
      while (index < lines.length) {
        const candidate = lines[index]!.trim();
        const match = orderedList
          ? candidate.match(/^\d+[.)]\s+(.+)$/)
          : candidate.match(/^[-*]\s+(.+)$/);
        if (!match?.[1]) break;
        items.push(match[1]);
        index += 1;
      }
      const List = orderedList ? "ol" : "ul";
      blocks.push(
        <List key={`list:${blocks.length}`}>
          {items.map((item, itemIndex) => (
            <li key={`item:${itemIndex}`}>
              {assistantInlineContent(
                item,
                `list:${blocks.length}:${itemIndex}`
              )}
            </li>
          ))}
        </List>
      );
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading?.[2]) {
      blocks.push(
        <strong
          className="tablet-message-heading"
          key={`heading:${blocks.length}`}
        >
          {assistantInlineContent(heading[2], `heading:${blocks.length}`)}
        </strong>
      );
      index += 1;
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote?.[1]) {
      blocks.push(
        <blockquote key={`quote:${blocks.length}`}>
          {assistantInlineContent(quote[1], `quote:${blocks.length}`)}
        </blockquote>
      );
      index += 1;
      continue;
    }

    blocks.push(
      <p key={`paragraph:${blocks.length}`}>
        {assistantInlineContent(line, `paragraph:${blocks.length}`)}
      </p>
    );
    index += 1;
  }

  return <div className="tablet-message-body">{blocks}</div>;
}
