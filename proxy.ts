import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import {
  clerkContentSecurityPolicyDirectives,
  createLocalContentSecurityPolicy
} from "@/lib/contentSecurityPolicy";
import { isCrossSiteMutation } from "@/lib/requestSecurity";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

const crossSiteMutationResponse = (request: NextRequest) =>
  isCrossSiteMutation({
    method: request.method,
    origin: request.headers.get("origin"),
    requestOrigin: request.nextUrl.origin,
    secFetchSite: request.headers.get("sec-fetch-site")
  })
    ? Response.json(
        { error: "Cross-site mutations are not allowed." },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      )
    : null;

const localSecurityMiddleware = (request: NextRequest) => {
  const policy = createLocalContentSecurityPolicy(process.env.NODE_ENV !== "production");
  const response = crossSiteMutationResponse(request) ?? NextResponse.next();
  response.headers.set("Content-Security-Policy", policy);
  return response;
};

export default clerkEnabled
  ? clerkMiddleware(
      (_auth, request) => crossSiteMutationResponse(request) ?? undefined,
      {
        contentSecurityPolicy: {
          strict: false,
          directives: clerkContentSecurityPolicyDirectives
        }
      }
    )
  : localSecurityMiddleware;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|webp|ico|woff2?|ttf|map)).*)",
    "/(api|trpc)(.*)"
  ]
};
