export const maxLiveStreamsPerProcess = 500;
export const maxLiveStreamsPerClient = 12;

const liveProblemWindowMs = 15 * 60 * 1000;
const maximumRecentProblems = 128;

export type LiveStreamProblem =
  | "capacity_rejected"
  | "replay_failed"
  | "replay_truncated"
  | "replay_backlog"
  | "write_backpressure"
  | "write_failed";

export type LiveStreamOperabilityStatus = {
  status: "unobserved" | "nominal" | "degraded";
  windowMinutes: number;
  activeStreams: number;
  peakStreams: number;
  connectionCount: number;
  resumedConnectionCount: number;
  rejectedConnectionCount: number;
  replayedEventCount: number;
  replayFailureCount: number;
  replayTruncationCount: number;
  recentProblemCount: number;
  lastConnectedAt: string | null;
  lastProblemAt: string | null;
};

const activeStreamsByClient = new Map<string, number>();
let activeStreamCount = 0;
let peakStreamCount = 0;
let connectionCount = 0;
let resumedConnectionCount = 0;
let rejectedConnectionCount = 0;
let replayedEventCount = 0;
let replayFailureCount = 0;
let replayTruncationCount = 0;
let lastConnectedAt: number | null = null;
let recentProblems: Array<{ kind: LiveStreamProblem; recordedAt: number }> = [];

const retainProblem = (kind: LiveStreamProblem, recordedAt: number) => {
  recentProblems.push({ kind, recordedAt });
  if (recentProblems.length > maximumRecentProblems) {
    recentProblems = recentProblems.slice(-maximumRecentProblems);
  }
};

export const acquireLiveStream = (
  clientKey: string,
  resumed: boolean,
  recordedAt = Date.now()
) => {
  const clientCount = activeStreamsByClient.get(clientKey) ?? 0;
  if (clientCount >= maxLiveStreamsPerClient || activeStreamCount >= maxLiveStreamsPerProcess) {
    rejectedConnectionCount += 1;
    retainProblem("capacity_rejected", recordedAt);
    return false;
  }
  activeStreamsByClient.set(clientKey, clientCount + 1);
  activeStreamCount += 1;
  peakStreamCount = Math.max(peakStreamCount, activeStreamCount);
  connectionCount += 1;
  if (resumed) resumedConnectionCount += 1;
  lastConnectedAt = recordedAt;
  return true;
};

export const releaseLiveStream = (clientKey: string) => {
  const clientCount = activeStreamsByClient.get(clientKey) ?? 0;
  if (clientCount <= 0) return;
  if (clientCount === 1) activeStreamsByClient.delete(clientKey);
  else activeStreamsByClient.set(clientKey, clientCount - 1);
  activeStreamCount = Math.max(0, activeStreamCount - 1);
};

export const recordLiveReplayEvents = (count: number) => {
  replayedEventCount += Math.max(0, Math.trunc(count));
};

export const recordLiveStreamProblem = (
  kind: LiveStreamProblem,
  recordedAt = Date.now()
) => {
  if (kind === "capacity_rejected") rejectedConnectionCount += 1;
  if (kind === "replay_failed") replayFailureCount += 1;
  if (kind === "replay_truncated") replayTruncationCount += 1;
  retainProblem(kind, recordedAt);
};

export const getLiveStreamOperabilityStatus = (now = Date.now()): LiveStreamOperabilityStatus => {
  const cutoff = now - liveProblemWindowMs;
  const problems = recentProblems.filter((problem) => problem.recordedAt >= cutoff && problem.recordedAt <= now);
  const lastProblemAt = problems.at(-1)?.recordedAt ?? null;
  return {
    status: connectionCount === 0 ? "unobserved" : problems.length ? "degraded" : "nominal",
    windowMinutes: liveProblemWindowMs / 60_000,
    activeStreams: activeStreamCount,
    peakStreams: peakStreamCount,
    connectionCount,
    resumedConnectionCount,
    rejectedConnectionCount,
    replayedEventCount,
    replayFailureCount,
    replayTruncationCount,
    recentProblemCount: problems.length,
    lastConnectedAt: lastConnectedAt === null ? null : new Date(lastConnectedAt).toISOString(),
    lastProblemAt: lastProblemAt === null ? null : new Date(lastProblemAt).toISOString()
  };
};

export const resetLiveStreamRegistry = () => {
  activeStreamsByClient.clear();
  activeStreamCount = 0;
  peakStreamCount = 0;
  connectionCount = 0;
  resumedConnectionCount = 0;
  rejectedConnectionCount = 0;
  replayedEventCount = 0;
  replayFailureCount = 0;
  replayTruncationCount = 0;
  lastConnectedAt = null;
  recentProblems = [];
};
