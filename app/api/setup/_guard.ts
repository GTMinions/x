/** Shared by the /api/setup routes: site admin, or 403. */
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/auth";
import { isSetupAdmin } from "@/app/lib/provision";

export async function guard(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!(await isSetupAdmin(session))) {
    return NextResponse.json({ error: "site administrator only — sign in with an address named in SITE_ADMIN_EMAILS" }, { status: 403 });
  }
  return null;
}

export function fail(err: unknown): NextResponse {
  return NextResponse.json({ error: (err as Error).message }, { status: 400 });
}
