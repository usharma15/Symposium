import { SymposiumV0 } from "@/components/SymposiumV0";

export default function Home() {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  return <SymposiumV0 clerkEnabled={clerkEnabled} />;
}
