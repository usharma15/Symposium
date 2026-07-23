export const enqueueConversationSend = (
  queues: Map<string, Promise<void>>,
  conversationId: string,
  send: () => Promise<void>
) => {
  const prior = queues.get(conversationId) ?? Promise.resolve();
  const queued = prior.then(send, send);
  queues.set(conversationId, queued);
  void queued.then(
    () => {
      if (queues.get(conversationId) === queued) queues.delete(conversationId);
    },
    () => {
      if (queues.get(conversationId) === queued) queues.delete(conversationId);
    }
  );
  return queued;
};
