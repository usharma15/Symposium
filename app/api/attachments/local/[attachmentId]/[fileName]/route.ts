import { jsonError } from "@/lib/api";
import { LocalAttachmentStoreError, readLocalAttachment } from "@/lib/localAttachmentStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ attachmentId: string; fileName: string }>;
};

const headerFileName = (fileName: string) => fileName.replace(/["\r\n]/g, "_");

export async function GET(_request: Request, context: Context) {
  const { attachmentId } = await context.params;

  try {
    const { record, bytes } = await readLocalAttachment(attachmentId);
    return new Response(new Blob([bytes], { type: record.contentType }), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `inline; filename="${headerFileName(record.fileName)}"`,
        "Content-Length": String(record.byteSize),
        "Content-Type": record.contentType
      }
    });
  } catch (error) {
    if (error instanceof LocalAttachmentStoreError) {
      return jsonError(error.message, error.status);
    }
    throw error;
  }
}
