import { NextResponse, type NextRequest } from "next/server";
import { getWish, followUpWish } from "@/app/_platform/wishes";
import { getSession, displayName } from "@/app/lib/auth";

/** POST /api/wishes/<id>/followup — reopen a shipped wish with a note. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getWish(Number(id)))) return NextResponse.json({ error: "no such wish" }, { status: 404 });
  const session = await getSession();
  let body: { text?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (!body.text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  const wish = await followUpWish(Number(id), body.text, session ? displayName(session) : "guest");
  return NextResponse.json({ ok: true, wish });
}
