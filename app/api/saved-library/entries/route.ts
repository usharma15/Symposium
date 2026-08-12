import { updateLocalSavedLibraryEntry } from "@/lib/localSavedLibraryStore";
import { workspaceMutation } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  return workspaceMutation(request, updateLocalSavedLibraryEntry);
}
