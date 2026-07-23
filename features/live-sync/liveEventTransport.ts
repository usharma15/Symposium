export type ServerSentEvent = {
  data: string;
  event: string;
  id?: string;
};

export const liveEventCursorIsAfter = (candidate: string, current: string) =>
  Boolean(candidate) && (!current || candidate > current);

export const createServerSentEventParser = (onEvent: (event: ServerSentEvent) => void) => {
  let buffer = "";
  let dataLines: string[] = [];
  let eventName = "message";
  let eventId: string | undefined;

  const dispatch = () => {
    if (!dataLines.length) {
      eventName = "message";
      eventId = undefined;
      return;
    }
    onEvent({
      data: dataLines.join("\n"),
      event: eventName,
      ...(eventId === undefined ? {} : { id: eventId })
    });
    dataLines = [];
    eventName = "message";
    eventId = undefined;
  };

  const acceptLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line) {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;

    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const rawValue = separator < 0 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") eventName = value || "message";
    else if (field === "data") dataLines.push(value);
    else if (field === "id" && !value.includes("\0")) eventId = value;
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        acceptLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    },
    finish() {
      if (buffer) acceptLine(buffer);
      buffer = "";
      dispatch();
    }
  };
};

export const consumeLiveEventStream = async ({
  fetchImpl = globalThis.fetch.bind(globalThis),
  onEvent,
  onOpen,
  signal,
  token,
  url
}: {
  fetchImpl?: typeof fetch;
  onEvent: (event: ServerSentEvent) => void;
  onOpen: () => void;
  signal: AbortSignal;
  token?: string | null;
  url: string;
}) => {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    signal
  });
  if (!response.ok) throw new Error(`Live event stream failed (${response.status}).`);
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream")) {
    throw new Error("Live event stream returned an unexpected content type.");
  }
  if (!response.body) throw new Error("Live event stream did not provide a response body.");

  onOpen();
  const parser = createServerSentEventParser(onEvent);
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.finish();
  } finally {
    reader.releaseLock();
  }
};
