import { createProtectedAttachmentRoute } from "@/lib/protectedAttachmentRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createProtectedAttachmentRoute((record, actorHandle) =>
  ["note", "note_comment"].includes(record.ownerType) &&
  (!record.actorHandle || record.actorHandle === actorHandle)
);
