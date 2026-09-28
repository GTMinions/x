/**
 * Session reading, for server components and route handlers.
 *
 * x used to be a client of an identity provider at a separate accounts service: that
 * service owned the account records, signed the token, and this module verified
 * against its remote JWKS. x is the provider now — `app/lib/identity/` mints the
 * token and holds the key — so verification is local and there is no network
 * call and no external service to be down.
 *
 * The cookie name (`x-session`) is unchanged on purpose: renaming it would
 * sign out everyone holding a valid session for no benefit.
 */
import "server-only";
import { cookies } from "next/headers";
import type { JWTPayload } from "jose";
import { verifyAccessToken } from "./identity/jwt";
import { localOwnerEmail, localSingleUserRequest } from "./onboarding";

/** The token issuer. Own URL by default — this deployment vouches for its own
 *  tokens. Override only to keep a fleet of apps on one shared issuer string. */
export const ISSUER =
  process.env.AUTH_ISSUER ??
  process.env.ACCOUNTS_ISSUER ??
  process.env.APP_URL ??
  "http://localhost:4000";

export interface Session extends JWTPayload {
  sub: string;                 // accounts external_id
  type?: "consumer" | "business" | "developer" | "service";
  scopes?: string[];
  email?: string;
  name?: string;
}

/** Verified session from the cookie, or null. */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get("x-session")?.value;
  if (token) {
    const claims = await verifyAccessToken(token);
    if (claims) return claims as unknown as Session;
  }
  // A site on the machine you are sitting at, answering on localhost, has one
  // user: its owner. See app/lib/onboarding.ts for when this is off.
  if (await localSingleUserRequest()) {
    return { sub: "local-owner", type: "consumer", scopes: ["admin"], email: await localOwnerEmail(), name: "Owner" };
  }
  return null;
}

/** True if the session carries any admin scope. */
export function isAdmin(session: Session | null): boolean {
  return !!session?.scopes?.some((s) => s === "admin" || s.startsWith("admin:"));
}

/**
 * Admin **of the site**, not of one product.
 *
 * `isAdmin` is true for any admin scope, which includes a product-scoped one like
 * `admin:ai-edu`. That is the right predicate for "can this person manage the wish
 * they are looking at", and the wrong one for a control that reaches across the
 * whole platform: Design Mode annotates ANY page, so gating it on `isAdmin` would
 * hand the admin of one product a tool over every other product and over the
 * platform's own pages.
 *
 * A site admin carries the bare `admin` scope, the wildcard `admin:*`, or owner.
 */
export function isSiteAdmin(session: Session | null): boolean {
  return !!session?.scopes?.some(
    (s) => s === "admin" || s === "admin:*" || s === "owner" || s.startsWith("owner:"),
  );
}

/** A display handle for the profile menu. */
export function displayName(session: Session | null): string {
  return session?.name || session?.email || "Guest";
}
