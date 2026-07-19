import { getSnapshot, upsertProfile, type CreateProfileInput } from "@/lib/dataStore";
import { jsonError, readJson } from "@/lib/api";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { publicResearchProfile } from "@/lib/publicProfile";
import { cleanHandle } from "@/lib/symposiumCore";

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
  const live = await proxyLiveBackend(`/v1/profiles?${liveQuery.toString()}`);
  if (live) return live;

  const snapshot = await getSnapshot();
  const normalizedQuery = query.toLocaleLowerCase().replace(/^@/, "");
  return Response.json({
    profiles: Object.fromEntries(Object.entries(snapshot.profiles)
      .filter(([handle, person]) => !normalizedQuery
        || cleanHandle(handle).toLocaleLowerCase().includes(normalizedQuery)
        || person.name.toLocaleLowerCase().includes(normalizedQuery))
      .sort(([leftHandle, left], [rightHandle, right]) => {
        if (!normalizedQuery) return 0;
        const leftCleanHandle = cleanHandle(leftHandle).toLocaleLowerCase();
        const rightCleanHandle = cleanHandle(rightHandle).toLocaleLowerCase();
        const leftName = left.name.toLocaleLowerCase();
        const rightName = right.name.toLocaleLowerCase();
        const score = (handle: string, name: string) => handle === normalizedQuery ? 0
          : name === normalizedQuery ? 1
            : handle.startsWith(normalizedQuery) ? 2
              : name.startsWith(normalizedQuery) ? 3
                : 4;
        return score(leftCleanHandle, leftName) - score(rightCleanHandle, rightName)
          || left.name.localeCompare(right.name)
          || leftCleanHandle.localeCompare(rightCleanHandle);
      })
      .slice(0, limit)
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
