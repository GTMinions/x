import { NextResponse } from "next/server";

/**
 * POST /api/auth/signout — best-effort local sign-out. Clears the session
 * cookies on this host and returns to the landing. Full session revocation
 * lives on the identity provider (/api/v1/auth/logout).
 *
 * The scope must match how the cookies were set, or the clear silently misses.
 */
const COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || undefined;

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url));
  const prod = process.env.NODE_ENV === "production";
  for (const name of ["x-session", "x-refresh"]) {
    res.cookies.set(name, "", {
      domain: COOKIE_DOMAIN,
      path: "/",
      httpOnly: true,
      secure: prod,
      sameSite: "lax",
      maxAge: 0,
    });
  }
  return res;
}
