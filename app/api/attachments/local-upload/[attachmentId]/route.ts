import { jsonError } from "@/lib/api";
import { LocalAttachmentStoreError, writeLocalAttachmentFile } from "@/lib/localAttachmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ attachmentId: string }>;
};

export async function PUT(request: Request, context: Context) {
  const { attachmentId } = await context.params;

  try {
    const bytes = Buffer.from(await request.arrayBuffer());
    const attachment = await writeLocalAttachmentFile(attachmentId, bytes);
    return Response.json({ attachmentId: attachment.attachmentId, status: attachment.status });
  } catch (error) {
    if (error instanceof LocalAttachmentStoreError) {
      return jsonError(error.message, error.status);
    }
    throw error;
  }
}
