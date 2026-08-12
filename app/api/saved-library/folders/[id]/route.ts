import { deleteLocalSavedLibraryFolder, updateLocalSavedLibraryFolder } from "@/lib/localSavedLibraryStore";
import { workspaceMutation } from "@/lib/workspaceRouteSupport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  return workspaceMutation(request, (payload, actorHandle) => updateLocalSavedLibraryFolder(id, payload, actorHandle));
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  return workspaceMutation(request, (payload, actorHandle) => deleteLocalSavedLibraryFolder(id, payload, actorHandle));
}
