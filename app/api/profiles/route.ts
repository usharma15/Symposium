import { getSnapshot, upsertProfile, type CreateProfileInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asFields = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",");
  return [];
};

export async function GET() {
  const live = await proxyLiveBackend("/v1/profiles");
  if (live) return live;

  const snapshot = await getSnapshot();
  return Response.json({ profiles: snapshot.profiles });
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
    role: String(body.role ?? "").trim(),
    location: String(body.location ?? "").trim(),
    bio: String(body.bio ?? "").trim(),
    fields: asFields(body.fields)
  };

  if (!input.name || !input.handle) {
    return jsonError("Name and handle are required.", 400);
  }

  const live = await proxyLiveBackend("/v1/profiles", {
    method: "POST",
    body: input,
    actorHandle: input.handle
  });
  if (live) return live;

  const profile = await upsertProfile(input);
  return Response.json({ profile });
}
