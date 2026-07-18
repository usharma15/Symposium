import type { FastifyRequest } from "fastify";
import { getActorFromRequest, requireActor } from "../services/auth";
import { rateLimit } from "../services/rateLimit";

export const withWriteActor = async (
  request: FastifyRequest,
  options: { shared?: boolean; scope?: string; limit?: number; windowSeconds?: number } = {}
) => {
  const actor = requireActor(await getActorFromRequest(request));
  await rateLimit(
    request,
    actor,
    options.scope ?? "write",
    options.limit ?? 120,
    options.windowSeconds ?? 60,
    { shared: options.shared ?? false }
  );
  return actor;
};
