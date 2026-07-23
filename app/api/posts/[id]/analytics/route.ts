import { proxyMessageRequest } from "@/lib/messageRouteSupport";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  return proxyMessageRequest(
    request,
    `/v1/posts/${encodeURIComponent(id)}/analytics${new URL(request.url).search}`
  );
}
