import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { googleStatus, googleRedirectUri, STATE_COOKIE, encodeState } from "@/app/lib/googleAuth";

/**
 * GET /api/v1/auth/google/start?next=/path — begins Google sign-in.
 *
 * Sends the user to Google's consent screen with a one-time `state` we also
 * stash in an httpOnly cookie; the callback rejects any response whose state
 * doesn't match, which is what stops a cross-site login CSRF.
 */
export async function GET(req: Request) {
  const { clientId: GOOGLE_CLIENT_ID } = await googleStatus();
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: "Google sign-in is not configured." }, { status: 500 });
  }
  const url = new URL(req.url);
  const rawNext = url.searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  // The state carries the destination so the callback knows where to land.
  const state = encodeState(randomBytes(16).toString("hex"), next);

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  auth.searchParams.set("redirect_uri", googleRedirectUri(url.origin));
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", state);
  auth.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(auth.toString());
  res.cookies.set(STATE_COOKIE, state, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // must survive Google's top-level redirect back to us
    maxAge: 600,
  });
  return res;
}
