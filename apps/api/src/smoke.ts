const baseUrl = (
  process.env.SYMPOSIUM_SMOKE_URL ??
  process.env.SYMPOSIUM_API_URL ??
  "http://localhost:4000"
).replace(/\/$/, "");

const readJson = async <T>(path: string): Promise<{ status: number; body: T }> => {
  const response = await fetch(`${baseUrl}${path}`);
  const body = (await response.json()) as T;
  return { status: response.status, body };
};

const main = async () => {
  const health = await readJson<{ ok?: boolean; service?: string }>("/healthz");
  if (health.status !== 200 || !health.body.ok) {
    throw new Error(`/healthz failed with ${health.status}: ${JSON.stringify(health.body)}`);
  }

  const bootstrap = await readJson<{
    profiles?: Record<string, unknown>;
    items?: unknown[];
    communities?: unknown[];
  }>("/v1/bootstrap");

  if (bootstrap.status !== 200) {
    throw new Error(`/v1/bootstrap failed with ${bootstrap.status}: ${JSON.stringify(bootstrap.body)}`);
  }

  const profileCount = Object.keys(bootstrap.body.profiles ?? {}).length;
  const itemCount = bootstrap.body.items?.length ?? 0;
  const communityCount = bootstrap.body.communities?.length ?? 0;

  if (!profileCount || !itemCount || !communityCount) {
    throw new Error(
      `/v1/bootstrap returned an incomplete world: ${JSON.stringify({
        profiles: profileCount,
        items: itemCount,
        communities: communityCount
      })}`
    );
  }

  const communities = await readJson<{ communities?: Array<{ id?: string }> }>("/v1/communities");
  if (communities.status !== 200 || !communities.body.communities?.length) {
    throw new Error(`/v1/communities failed with ${communities.status}: ${JSON.stringify(communities.body)}`);
  }

  const firstCommunityId = communities.body.communities[0]?.id;
  if (!firstCommunityId) throw new Error("/v1/communities did not return a community id.");

  const calls = await readJson<{ calls?: unknown[] }>(`/v1/communities/${firstCommunityId}/calls`);
  if (calls.status !== 200 || !Array.isArray(calls.body.calls)) {
    throw new Error(`/v1/communities/${firstCommunityId}/calls failed with ${calls.status}: ${JSON.stringify(calls.body)}`);
  }

  const opportunities = await readJson<{ opportunities?: unknown[] }>("/v1/opportunities");
  if (opportunities.status !== 200 || !Array.isArray(opportunities.body.opportunities)) {
    throw new Error(`/v1/opportunities failed with ${opportunities.status}: ${JSON.stringify(opportunities.body)}`);
  }

  const invalidOpportunityFilter = await readJson<{ error?: string; issues?: unknown[] }>(
    "/v1/opportunities?status=invalid"
  );
  if (invalidOpportunityFilter.status !== 400 || invalidOpportunityFilter.body.error !== "Invalid request payload.") {
    throw new Error(
      `/v1/opportunities validation returned ${invalidOpportunityFilter.status}: ${JSON.stringify(
        invalidOpportunityFilter.body
      )}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        service: health.body.service,
        profiles: profileCount,
        items: itemCount,
        communities: communityCount,
        communityCallsChecked: firstCommunityId,
        opportunities: opportunities.body.opportunities.length
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
