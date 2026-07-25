import { SymposiumPage } from "@/app/SymposiumPage";
import { parseAssistantBackdrop } from "@/features/navigation/canonicalRoute";

export default async function AssistantThreadPage({
  params,
  searchParams
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<{ backdrop?: string | string[] }>;
}) {
  const { threadId } = await params;
  const query = await searchParams;
  const backdrop = parseAssistantBackdrop(query.backdrop);
  return (
    <SymposiumPage
      initialRoute={{ kind: "assistant", threadId, backdrop }}
    />
  );
}
