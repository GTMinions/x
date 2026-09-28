/**
 * Access gate (Next 16 `proxy`). The platform is private: only `/` (which just
 * routes), the `/get-started` landing page, `/about`, and the sign-in hand-off
 * are public. Every feature —
 * products, research, workspaces, wishes, settings, and their APIs — requires a
 * valid session.
 *
 * The session is the `x-session` cookie (RS256), verified here against this
 * app's OWN JWKS. Signed-out visitors are sent to /sign-in?next=<original>,
 * which is a page on this origin — there is no external identity service in the
 * request path.
 *
 * WHY FETCH OUR OWN JWKS RATHER THAN IMPORT THE KEY (when no key is pinned)
 * Middleware is a separate, lighter runtime; pulling in the identity module
 * would drag libsql and drizzle into every request that touches any route. So
 * the proxy reads the public half over HTTP from `/.well-known/jwks.json` on
 * this same deployment, cached for five minutes. Same key, no database, one
 * warm fetch per instance per window.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, importJWK, jwtVerify, type CryptoKey } from "jose";

/** Must match `app/lib/identity/jwt.ts` — same variables, same order. */
const ISSUER =
  process.env.AUTH_ISSUER ??
  process.env.ACCOUNTS_ISSUER ??
  process.env.APP_URL ??
  "http://localhost:4000";

/**
 * WHEN THE KEY IS IN THE ENVIRONMENT, USE IT — NO FETCH AT ALL
 * A deployment that pins its keypair (ACCOUNTS_JWT_PUBLIC_KEY, the same JWK
 * the JWKS route publishes) gives the proxy the public half for free. This is
 * more than a saved round trip: on a Vercel preview behind deployment
 * protection, the proxy's own fetch of /.well-known/jwks.json is answered by
 * the SSO gate's redirect, not by JSON, so every session verified as invalid
 * and a signed-in person was sent back to /sign-in for ever. The JWKS fetch
 * stays as the path for a deployment whose key was generated into its
 * database.
 */
let _envKey: Promise<CryptoKey | Uint8Array> | null = null;
function envPublicKey(): Promise<CryptoKey | Uint8Array> | null {
  const raw = process.env.ACCOUNTS_JWT_PUBLIC_KEY;
  if (!raw) return null;
  if (!_envKey) {
    _envKey = importJWK(JSON.parse(raw), "RS256").catch((err) => {
      _envKey = null;
      throw err;
    });
  }
  return _envKey;
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let _jwksOrigin: string | null = null;

/** Keyed by origin so a preview deployment verifies against its own keys rather
 *  than whichever origin happened to warm the cache first. */
function getJwks(origin: string) {
  if (!_jwks || _jwksOrigin !== origin) {
    _jwks = createRemoteJWKSet(new URL(`${origin}/.well-known/jwks.json`), {
      cacheMaxAge: 5 * 60 * 1000,
    });
    _jwksOrigin = origin;
  }
  return _jwks;
}

// `/api/billing/webhook` is exact, not a prefix: the payment provider calls it
// with a signed body and no browser, so a session gate here means every payment
// event bounces off the sign-in wall and nobody's tier ever changes — a failure
// that looks like "webhooks are flaky" rather than what it is. The route
// authenticates by signature; its siblings (checkout, portal) act on behalf of
// a person and stay behind the session gate.
// `/api/setup/settings` runs before any account can exist (a fresh deployment).
// It authenticates inside: a site admin, local single-user, or the owner proof
// (the host key) — see app/lib/onboarding.ts.
const PUBLIC_EXACT = new Set(["/", "/api/billing/webhook", "/api/setup/settings"]);
// `/about` is public: it says who builds the platform and on what bar, and a page
// answering that question behind a sign-in wall answers it to nobody.
// `/api/auth/` = x's own OTP sign-in; `/api/v1/auth/` = the Google OAuth start +
// callback. Both must answer while the caller is still signed out.
//
// `/.well-known/` MUST stay public and must never be gated: this proxy verifies
// sessions by fetching `/.well-known/jwks.json` from this same origin, so gating
// it would mean the check for "are you signed in" depends on being signed in.
// Nobody could ever authenticate. A JWKS is public by design anyway.
// `/api/internal/` is machine-to-machine: the build worker calling in, with no
// browser and therefore no session cookie. It is exempt from the session gate
// and NOT from authentication — every route under it checks
// `WISH_WORKER_TOKEN` itself, and an unset token makes those routes refuse
// rather than open. Listing it here without that property would publish it.
// `/get-started` is public for the same reason `/about` is: it is the page a
// person reads BEFORE deciding to sign up, and it is where ads point. A landing
// page behind a sign-in wall lands nobody. `/pricing` is the old address for it
// and only redirects. Buying still requires a session — the checkout route
// checks it — so nothing here weakens the gate around features.
const PUBLIC_PREFIXES = ["/about", "/setup", "/get-started", "/pricing", "/sign-in", "/api/auth/", "/api/v1/auth/", "/api/internal/", "/.well-known/", "/_next/", "/favicon", "/robots.txt", "/sitemap.xml"];
const PUBLIC_EXTS = [".ico", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".css", ".js", ".map", ".woff", ".woff2", ".ttf", ".txt", ".xml"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (PUBLIC_EXTS.some((ext) => pathname.endsWith(ext))) return true;
  return false;
}

async function hasSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("x-session")?.value;
  if (!token) return false;
  try {
    const pinned = envPublicKey();
    if (pinned) {
      await jwtVerify(token, await pinned, { issuer: ISSUER });
    } else {
      await jwtVerify(token, getJwks(req.nextUrl.origin), { issuer: ISSUER });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Local single-user: a site on the machine you are sitting at, answering on
 * localhost, with nobody to keep out. Mirrors app/lib/onboarding.ts — off on
 * Vercel, off in a production build unless X_SINGLE_USER=1, off everywhere
 * when X_SINGLE_USER=0, off for any other hostname.
 */
function localSingleUser(req: NextRequest): boolean {
  if (process.env.VERCEL) return false;
  const flag = process.env.X_SINGLE_USER;
  if (flag === "0") return false;
  if (flag !== "1" && process.env.NODE_ENV === "production") return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host.trim());
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();
  if (localSingleUser(req)) return NextResponse.next();
  if (await hasSession(req)) return NextResponse.next();

  // APIs answer 401 (no redirect); pages bounce to sign-in.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }
  const signInUrl = new URL("/sign-in", req.url);
  signInUrl.searchParams.set("next", `${pathname}${search || ""}`);
  const res = NextResponse.redirect(signInUrl);
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
