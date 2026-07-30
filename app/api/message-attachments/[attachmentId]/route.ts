import { createProtectedAttachmentRoute } from "@/lib/protectedAttachmentRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The local preview has no second authenticated participant. Keep delivery
// fail-closed to the uploader instead of making message objects public.
export const GET = createProtectedAttachmentRoute((record, actorHandle) =>
  record.ownerType === "message" &&
  Boolean(record.actorHandle) &&
  record.actorHandle === actorHandle
);
