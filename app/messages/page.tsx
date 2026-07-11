import { SymposiumPage } from "@/app/SymposiumPage";

export default async function MessagesPage({
  searchParams
}: {
  searchParams: Promise<{ conversation?: string | string[] }>;
}) {
  const query = await searchParams;
  const conversationId = Array.isArray(query.conversation) ? query.conversation[0] : query.conversation;
  return <SymposiumPage initialRoute={{ kind: "messages", conversationId }} />;
}
