import { createProtectedAttachmentRoute } from "@/lib/protectedAttachmentRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createProtectedAttachmentRoute((record, actorHandle) =>
  record.ownerType === "assistant_message" &&
  Boolean(record.actorHandle) &&
  record.actorHandle === actorHandle
);
