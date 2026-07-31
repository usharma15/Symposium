import { getSnapshot, upsertProfile } from "@/lib/localPreviewStore";
import type { CreateProfileInput } from "@/lib/localPreviewStoreTypes";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveApiRequest } from "@/lib/liveBackendClient";
import { publicResearchProfile, searchPublicProfileEntries } from "@/lib/publicProfile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asFields = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",");
  return [];
};

const asOptionalString = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const query = parameters.get("q")?.trim().slice(0, 120) ?? "";
  const limit = Math.max(1, Math.min(Number(parameters.get("limit")) || 50, 50));
  const liveQuery = new URLSearchParams({ limit: String(limit) });
  if (query) liveQuery.set("q", query);
  const live = await proxyLiveApiRequest(request, {
    sourcePath: `/api/profiles?${liveQuery.toString()}`
  });
  if (live) return live;

  const snapshot = await getSnapshot();
  return Response.json({
    profiles: Object.fromEntries(searchPublicProfileEntries(snapshot.profiles, query, limit)
      .map(([handle, person]) => [handle, publicResearchProfile(person)]))
  });
}

export async function POST(request: Request) {
  const body = await readJson<Partial<CreateProfileInput>>(request);

  if (!body) {
    return jsonError("Invalid JSON body.", 400);
  }

  const input: CreateProfileInput = {
    name: String(body.name ?? "").trim(),
    handle: String(body.handle ?? "").trim(),
    email: String(body.email ?? "").trim(),
    avatarUrl: asOptionalString(body.avatarUrl),
    likesPublic: typeof body.likesPublic === "boolean" ? body.likesPublic : undefined,
    resharesPublic: typeof body.resharesPublic === "boolean" ? body.resharesPublic : undefined,
    role: String(body.role ?? "").trim(),
    location: String(body.location ?? "").trim(),
    bio: String(body.bio ?? "").trim().slice(0, 200),
    fields: asFields(body.fields)
  };

  if (!input.name || !input.handle) {
    return jsonError("Name and handle are required.", 400);
  }

  const live = await proxyLiveApiRequest(request, {
    body: input,
    actorHandle: input.handle
  });
  if (live) return live;

  const profile = await upsertProfile(input);
  return Response.json({ profile });
}
