import { SymposiumV0 } from "@/components/SymposiumV0";
import { auth } from "@clerk/nextjs/server";
import { entranceSessionCookieName } from "@/features/entrance/browserSession";
import type { CanonicalRoute } from "@/features/navigation/canonicalRoute";
import { cookies } from "next/headers";

export async function SymposiumPage({ initialRoute = { kind: "hall" } }: { initialRoute?: CanonicalRoute }) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  const liveBackendUrl = process.env.SYMPOSIUM_API_URL?.replace(/\/$/, "") ?? null;
  const browserSessionSeen = (await cookies()).get(entranceSessionCookieName)?.value === "1";
  const initiallySignedIn = clerkEnabled ? Boolean((await auth()).userId) : null;
  return (
    <SymposiumV0
      clerkEnabled={clerkEnabled}
      initialIsSignedIn={initiallySignedIn}
      initialRoute={initialRoute}
      initialShouldPlayEntrance={browserSessionSeen ? false : null}
      liveBackendUrl={liveBackendUrl}
    />
  );
}
