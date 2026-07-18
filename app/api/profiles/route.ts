import { getSnapshot, upsertProfile, type CreateProfileInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { publicResearchProfile } from "@/lib/publicProfile";

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

export async function GET() {
  const live = await proxyLiveBackend("/v1/profiles");
  if (live) return live;

  const snapshot = await getSnapshot();
  return Response.json({
    profiles: Object.fromEntries(Object.entries(snapshot.profiles).slice(0, 50)
      .map(([handle, person]) => [handle, publicResearchProfile(person)]))
  });
}

export async function POST(request: Request) {
  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
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

  const live = await proxyLiveBackend("/v1/profiles", {
    method: "POST",
    body: input,
    actorHandle: input.handle,
    idempotencyKey
  });
  if (live) return live;

  const profile = await upsertProfile(input);
  return Response.json({ profile });
}
