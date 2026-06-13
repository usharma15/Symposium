import { getSnapshot, upsertProfile, type CreateProfileInput } from "@/lib/dataStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const asFields = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(",");
  return [];
};

export async function GET() {
  const snapshot = await getSnapshot();
  return Response.json({ profiles: snapshot.profiles });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<CreateProfileInput>;
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
    return Response.json({ error: "Name and handle are required." }, { status: 400 });
  }

  const profile = await upsertProfile(input);
  return Response.json({ profile });
}
