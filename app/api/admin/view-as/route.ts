import { NextResponse, type NextRequest } from "next/server";

import { getSession, isSiteAdmin } from "@/app/lib/auth";
import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { IMPERSONATE_COOKIE } from "@/app/lib/impersonation";

/**
 * Start or stop viewing the site as another user.
 *
 * Site admins only, and the check is here as well as in the reader: a cookie
 * this route refuses to set is one nothing has to defend against later.
 *
 * The cookie is deliberately session-scoped (no `maxAge`) — closing the browser
 * ends the borrowed view. A support tool that quietly persists across days is
 * one somebody forgets they are inside.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.email || !isSiteAdmin(session)) {
    return NextResponse.json({ error: "site admins only" }, { status: 403 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Stop.
  if (payload.stop === true || !payload.email) {
    const res = NextResponse.json({ ok: true, viewingAs: null });
    res.cookies.delete(IMPERSONATE_COOKIE);
    return res;
  }

  const email = String(payload.email).trim().toLowerCase();
  if (email === session.email.toLowerCase()) {
    return NextResponse.json({ error: "that is already you" }, { status: 400 });
  }

  // Resolved now so the toolbar can say "no such account" instead of rendering
  // an empty view that looks like a bug in the page.
  const account = await findAccountByEmail(email);
  if (!account) {
    return NextResponse.json({ error: `no account for ${email}` }, { status: 404 });
  }

  console.warn(`[view-as] ${session.email} is now viewing as ${email}`);

  const res = NextResponse.json({ ok: true, viewingAs: email });
  res.cookies.set(IMPERSONATE_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
}
