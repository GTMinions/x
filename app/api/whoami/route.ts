import { NextResponse } from "next/server";
import { getSession, displayName, isAdmin } from "@/app/lib/auth";
import { isSiteAdmin } from "@/app/lib/platform";

/** GET /api/whoami — the current viewer, for the top bar + author-only controls. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ signedIn: false, nickname: null });
  return NextResponse.json({
    signedIn: true,
    nickname: displayName(session),
    email: session.email,
    admin: isAdmin(session) || (await isSiteAdmin(session.email)),
  });
}
