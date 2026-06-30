import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { getActorFromRequest, requireActor, type Actor } from "./services/auth";
import { rateLimit } from "./services/rateLimit";

export type ApiContext = {
  actor: Actor;
  req: CreateFastifyContextOptions["req"];
  res: CreateFastifyContextOptions["res"];
};

export const createContext = async ({ req, res }: CreateFastifyContextOptions): Promise<ApiContext> => ({
  actor: await getActorFromRequest(req),
  req,
  res
});

const t = initTRPC.context<ApiContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const actor = requireActor(ctx.actor);
  await rateLimit(ctx.req, actor, "write", 120, 60);
  return next({ ctx: { ...ctx, actor } });
});

export const strictAuthedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.actor.isAuthenticated) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "A verified Symposium account is required."
    });
  }
  return next();
});
