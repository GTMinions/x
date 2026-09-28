import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/app/lib/auth";
import { addComp, removeComp } from "@/app/lib/comps";
import { roleAtLeast } from "@/app/lib/memberships";

/**
 * The guest list, written.
 *
 * Site admins only — an entry here grants free access AND top queue position
 * across every product, so it is not something a product's admin hands out.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!(await roleAtLeast(session?.email, "site", "site", "admin"))) {
    return NextResponse.json({ error: "site admins only" }, { status: 403 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email : "";
  if (!email.trim()) return NextResponse.json({ error: "email required" }, { status: 400 });

  try {
    if (payload.action === "remove") {
      await removeComp(email);
      return NextResponse.json({ ok: true, removed: email });
    }
    const note = typeof payload.note === "string" ? payload.note : null;
    await addComp(email, note, session?.email ?? "admin");
    return NextResponse.json({ ok: true, added: email.trim().toLowerCase() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
