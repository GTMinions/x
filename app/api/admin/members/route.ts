import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/app/lib/auth";
import { roleAtLeast, setMembership, removeMembership, membershipsPersisted, type ScopeType, type Role } from "@/app/lib/platform";

/** POST /api/admin/members — set or remove a membership. Admin-at-scope only. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  const body = await req.json().catch(() => ({}));
  const { scopeType, scopeId, email, role, remove } = body as { scopeType: ScopeType; scopeId: string; email: string; role?: Role; remove?: boolean };
  if (!scopeType || !scopeId || !email) return NextResponse.json({ error: "missing fields" }, { status: 400 });
  if (!(await roleAtLeast(session?.email, scopeType, scopeId, "admin"))) return NextResponse.json({ error: "admin only" }, { status: 403 });
  if (email.toLowerCase() === session?.email?.toLowerCase() && remove) return NextResponse.json({ error: "can't remove yourself" }, { status: 400 });
  // The write can fail — GitHub unreachable, or an attempt to remove a bootstrap
  // admin. It used to be impossible for the caller to find out: the handler always
  // returned {ok:true}. That is why the bug reads as "cannot add site admin" with
  // no reason given.
  try {
    if (remove) await removeMembership(email, scopeType, scopeId);
    else await setMembership(email, scopeType, scopeId, role ?? "reader");
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, persisted: membershipsPersisted() });
}
