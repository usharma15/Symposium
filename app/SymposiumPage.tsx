import { SymposiumV0 } from "@/components/SymposiumV0";
import { entranceSessionCookieName } from "@/features/entrance/browserSession";
import type { CanonicalRoute } from "@/features/navigation/canonicalRoute";
import { cookies } from "next/headers";

export async function SymposiumPage({ initialRoute = { kind: "hall" } }: { initialRoute?: CanonicalRoute }) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  const browserSessionSeen = (await cookies()).get(entranceSessionCookieName)?.value === "1";
  return (
    <SymposiumV0
      clerkEnabled={clerkEnabled}
      initialRoute={initialRoute}
      initialShouldPlayEntrance={browserSessionSeen ? false : null}
    />
  );
}
