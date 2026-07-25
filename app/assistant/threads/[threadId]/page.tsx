import { SymposiumPage } from "@/app/SymposiumPage";

export default async function AssistantThreadPage({
  params
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  return (
    <SymposiumPage
      initialRoute={{ kind: "assistant", threadId }}
    />
  );
}
