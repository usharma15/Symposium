import { canAccessLocalOpportunityApplication } from "@/lib/localOpportunityApplicationStore";
import { createProtectedAttachmentRoute } from "@/lib/protectedAttachmentRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createProtectedAttachmentRoute((record, actorHandle) =>
  record.ownerType === "opportunity_application" &&
  Boolean(record.ownerId) &&
  canAccessLocalOpportunityApplication(record.ownerId!, actorHandle)
);
