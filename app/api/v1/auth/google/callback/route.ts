import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  googleStatus,
  STATE_COOKIE,
  decodeState,
  googleRedirectUri,
} from "@/app/lib/googleAuth";
import { accountsDbConfigured } from "@/app/lib/identity/db";
import { findOrCreateByOAuth } from "@/app/lib/identity/accounts";
import { issueSession } from "@/app/lib/identity/sessions";
import { mintAccessToken } from "@/app/lib/identity/jwt";
import { scopesForRole, type AccountRole } from "@/app/lib/identity/scopes";


import { adminEmails } from "@/app/lib/onboarding";
/**
 * GET /api/v1/auth/google/callback — the redirect URI registered on the Google
 * OAuth client for this app.
 *
 * Google hands us `?code`. We exchange it for tokens, read the profile, then
 * find-or-create the account in the shared identity DB and mint
 * the session with the key accounts publishes on its JWKS. The row and the token
 * are the ones accounts itself would have written.
 *
 * This used to POST the ID token to `the accounts service's Google endpoint`.
 * That route does not exist — accounts only ever shipped the email-code endpoints
 * — so the flow died at the last step with `google-signin-failed`. a sibling app had
 * already solved the same problem by writing to the shared DB directly, and this
 * is that path, reusing edu's identity layer verbatim.
 *
 * x is a *co-signer*, not a second identity provider: it never generates a key
 * and never runs DDL. accounts owns the schema and the key lifecycle.
 */
const ACCESS_COOKIE = "x-session";
const REFRESH_COOKIE = "x-refresh";
// Host-only unless a parent domain is named. A shared value only works across
// subdomains of one registrable domain, so it stays opt-in via env.
const COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || undefined;
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

function fail(origin: string, reason: string) {
  const to = new URL("/sign-in", origin);
  to.searchParams.set("error", reason);
  const res = NextResponse.redirect(to);
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

function sameState(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  const { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET } = await googleStatus();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return fail(origin, "google-not-configured");
  if (url.searchParams.get("error")) return fail(origin, "google-denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail(origin, "google-bad-response");

  // The state must match the one we set before leaving for Google. Set-Cookie
  // serialization percent-encodes the value, so decode before comparing —
  // Google echoes `state` back exactly as we sent it.
  const raw = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);
  let cookieState: string | undefined;
  try {
    cookieState = raw ? decodeURIComponent(raw) : undefined;
  } catch {
    cookieState = raw;
  }
  if (!cookieState || !sameState(cookieState, state)) return fail(origin, "google-state-mismatch");

  const decoded = decodeState(state);
  if (!decoded) return fail(origin, "google-bad-state");

  // The session is written to the shared identity DB. Without it there is no
  // account to find and no key to sign with, so say that rather than let the
  // first query fail with a bare "no such table".
  if (!accountsDbConfigured()) {
    console.error("[google/callback] ACCOUNTS_DATABASE_URL is not set — cannot reach the shared identity DB");
    return fail(origin, "identity-not-configured");
  }

  // 1. Exchange the auth code with Google. We want the access token: the profile
  //    comes from the userinfo endpoint, which is the same source edu reads.
  let accessToken: string | undefined;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: googleRedirectUri(origin),
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    const data = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokenRes.ok || !data.access_token) {
      // Google puts the actionable part in the body — redirect_uri_mismatch,
      // invalid_client, invalid_grant. The status alone is undiagnosable, and
      // redirect_uri_mismatch is the failure a new deployment always hits first.
      const detail = await tokenRes.text().catch(() => "");
      console.error("[google/callback] token exchange failed", tokenRes.status, detail.slice(0, 300));
      return fail(origin, "google-exchange-failed");
    }
    accessToken = data.access_token;
  } catch (e) {
    console.error("[google/callback] token exchange error", e);
    return fail(origin, "google-exchange-failed");
  }

  // 2. Read the profile, then find-or-create the account in the shared DB and
  //    mint the session. x is a co-signer on accounts' key, not a second issuer.
  let token: string;
  let expiresAt: number;
  let refreshToken: string;
  let refreshExp: number;
  try {
    const infoRes = await fetch(USERINFO, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!infoRes.ok) {
      console.error("[google/callback] userinfo failed", infoRes.status);
      return fail(origin, "google-bad-response");
    }
    const info = (await infoRes.json()) as {
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!info.email) return fail(origin, "google-no-email");
    // `email_verified` is the only thing vouching for this address. Linking an
    // existing account on an unverified one would let anyone who can set that
    // address on a Google profile walk into it.
    if (!info.email_verified) return fail(origin, "google-email-unverified");

    const { account } = await findOrCreateByOAuth({
      provider: "google",
      providerUserId: info.sub,
      email: info.email,
      emailVerified: info.email_verified,
      name: info.name,
      avatarUrl: info.picture,
      raw: info,
    });

    const session = await issueSession({
      accountId: account.id,
      userAgent: req.headers.get("user-agent") ?? undefined,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
    });
    const access = await mintAccessToken({
      externalId: account.externalId,
      type: account.accountType,
      // Same rule as the OTP path: computed from the bootstrap list at sign-in,
      // never read from a stored column.
      scopes: scopesForRole((await adminEmails()).includes((account.primaryEmail ?? "").toLowerCase()) ? "admin" : "user"),
      email: account.primaryEmail ?? undefined,
      name: account.displayName ?? undefined,
    });
    token = access.token;
    expiresAt = access.expiresAt;
    refreshToken = session.refreshToken;
    refreshExp = session.expiresAt;
  } catch (e) {
    console.error("[google/callback] sign-in failed", e);
    return fail(origin, "google-signin-failed");
  }

  // 3. Set the session on x's own origin and land where the user was
  //    originally headed.
  const prod = process.env.NODE_ENV === "production";
  const res = NextResponse.redirect(new URL(decoded.next, origin));
  const cookie = {
    domain: COOKIE_DOMAIN,
    path: "/",
    httpOnly: true,
    secure: prod,
    sameSite: "lax" as const,
  };
  res.cookies.set(ACCESS_COOKIE, token, { ...cookie, expires: new Date(expiresAt * 1000) });
  res.cookies.set(REFRESH_COOKIE, refreshToken, { ...cookie, expires: new Date(refreshExp * 1000) });
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
