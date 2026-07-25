import { SymposiumPage } from "@/app/SymposiumPage";
import { parseAssistantBackdrop } from "@/features/navigation/canonicalRoute";

export default async function AssistantPage({
  searchParams
}: {
  searchParams: Promise<{ backdrop?: string | string[] }>;
}) {
  const query = await searchParams;
  const backdrop = parseAssistantBackdrop(query.backdrop);
  return <SymposiumPage initialRoute={{ kind: "assistant", backdrop }} />;
}
