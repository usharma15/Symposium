import { auth, currentUser } from "@clerk/nextjs/server";
import { jsonError } from "@/lib/api";
import { upsertProfile, type CreateProfileInput } from "@/lib/dataStore";
import { proxyLiveBackend } from "@/lib/liveBackendClient";
import { cleanHandle } from "@/lib/symposiumCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

const handleFromIdentity = (name: string, email?: string | null, username?: string | null) =>
  cleanHandle(username || email?.split("@")[0] || name || "symposium_member");

export async function POST() {
  if (!clerkEnabled) {
    return jsonError("Clerk is not configured for this environment.", 503);
  }

  const clerkAuth = await auth();

  if (!clerkAuth.userId) {
    return jsonError("A Clerk session is required.", 401);
  }

  const user = await currentUser();

  if (!user) {
    return jsonError("Could not load Clerk user.", 401);
  }

  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  const name = user.fullName || user.username || email?.split("@")[0] || "Symposium member";
  const handle = handleFromIdentity(name, email, user.username);
  const input: CreateProfileInput = {
    name,
    handle,
    email,
    role: "Symposium participant",
    location: "Public rooms",
    bio: "A participant in the current inquiry thread.",
    fields: ["Inquiry"]
  };

  const live = await proxyLiveBackend("/v1/auth/sync", {
    method: "POST",
    body: {
      clerkUserId: clerkAuth.userId,
      email,
      name,
      handle,
      imageUrl: user.imageUrl
    },
    actorHandle: handle
  });
  if (live) return live;

  const profile = await upsertProfile(input);
  return Response.json({ profile });
}
