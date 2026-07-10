import type { FastifyRequest } from "fastify";
import { getActorFromRequest, requireActor } from "../services/auth";
import { rateLimit } from "../services/rateLimit";

export const withWriteActor = async (request: FastifyRequest) => {
  const actor = requireActor(await getActorFromRequest(request));
  await rateLimit(request, actor, "write", 120, 60);
  return actor;
};
