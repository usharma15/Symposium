import type {
  AssistantContextContract,
  AssistantMessageInputContract
} from "@/packages/contracts/src";

export const assistantContextKey = (
  context: Pick<AssistantContextContract, "surface" | "entityId" | "route">
) =>
  `${context.surface}:${context.entityId?.trim() || context.route.trim() || "/"}`
    .slice(0, 800);

export const assistantContextTypeForSurface = (
  surface: AssistantContextContract["surface"]
): AssistantMessageInputContract["contextType"] => {
  if (
    surface === "post" ||
    surface === "opportunity" ||
    surface === "attachment"
  ) {
    return "post";
  }
  if (surface === "community") return "community";
  if (surface === "workspace") return "note";
  if (surface === "room") return "room";
  return "general";
};
