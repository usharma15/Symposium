import { SymposiumPage } from "@/app/SymposiumPage";

export default async function OpportunityApplicationsPage({
  params,
  searchParams
}: {
  params: Promise<{ postId: string }>;
  searchParams: Promise<{ application?: string | string[] }>;
}) {
  const [{ postId }, query] = await Promise.all([params, searchParams]);
  const applicationId = Array.isArray(query.application) ? query.application[0] : query.application;

  return <SymposiumPage initialRoute={{ kind: "opportunityApplications", postId, applicationId }} />;
}
