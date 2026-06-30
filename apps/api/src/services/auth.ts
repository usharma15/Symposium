import { TRPCError } from "@trpc/server";
import { verifyToken } from "@clerk/backend";
import type { FastifyRequest } from "fastify";
import { cleanHandle } from "@/lib/symposiumCore";
import { env, requireAuthForWrites } from "../config/env";

export type Actor = {
  clerkUserId?: string;
  handle?: string;
  email?: string;
  name?: string;
  imageUrl?: string;
  isAuthenticated: boolean;
  source: "anonymous" | "clerk" | "dev";
};

const bearerToken = (authorization?: string) => {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
};

const headerValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const getActorFromRequest = async (request: FastifyRequest): Promise<Actor> => {
  const token = bearerToken(headerValue(request.headers.authorization));

  if (token && env.CLERK_SECRET_KEY) {
    let payload: Awaited<ReturnType<typeof verifyToken>>;

    try {
      payload = await verifyToken(token, {
        secretKey: env.CLERK_SECRET_KEY,
        audience: env.CLERK_JWT_AUDIENCE
      });
    } catch {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid Clerk session token."
      });
    }

    const email = typeof payload.email === "string" ? payload.email : undefined;
    const handle = typeof payload.username === "string" ? cleanHandle(payload.username) : undefined;
    const name = typeof payload.name === "string" ? payload.name : undefined;
    const imageUrl = typeof payload.picture === "string" ? payload.picture : undefined;

    return {
      clerkUserId: payload.sub,
      email,
      handle,
      name,
      imageUrl,
      isAuthenticated: true,
      source: "clerk"
    };
  }

  if (env.SYMPOSIUM_ALLOW_DEV_ACTOR) {
    const handle = headerValue(request.headers["x-symposium-handle"]);
    const name = headerValue(request.headers["x-symposium-name"]);
    const email = headerValue(request.headers["x-symposium-email"]);

    if (handle) {
      return {
        handle: cleanHandle(handle),
        name,
        email,
        isAuthenticated: true,
        source: "dev"
      };
    }
  }

  return { isAuthenticated: false, source: "anonymous" };
};

export const requireActor = (actor: Actor) => {
  if (!requireAuthForWrites && env.SYMPOSIUM_ALLOW_DEV_ACTOR) {
    return actor.handle ? actor : { ...actor, handle: "@usharma", isAuthenticated: true, source: "dev" as const };
  }

  if (!actor.isAuthenticated) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "A verified Symposium account is required for this action."
    });
  }

  return actor;
};
