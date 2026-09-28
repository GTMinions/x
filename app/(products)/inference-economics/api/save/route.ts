/**
 * /inference-economics/api/save — one save per business line, per account.
 *
 *   GET            → { online, saves: [{ line, state, updatedAt }] }
 *   PUT  { line, state }   store (state is the game's own JSON text)
 *   DELETE ?line=  clear
 *
 * The account is the session's subject; a person's saves follow their
 * sign-in across devices, which is the whole point of keeping them here
 * rather than in the browser.
 */
import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/app/lib/auth";
import { readProductOrDenial } from "@/app/lib/access";
import { GAME_SLUG } from "../../data/schema";
import { deleteSave, listSaves, putSave, LINES, type Line } from "../../_db";

export const dynamic = "force-dynamic";

const MAX_STATE = 200_000; // bytes; a full seven-year save is ~10 KB

async function who(): Promise<{ account: string } | NextResponse> {
  const session = await getSession();
  if (!session?.sub) return NextResponse.json({ error: "sign in to keep a save" }, { status: 401 });
  const access = await readProductOrDenial(session.email, GAME_SLUG);
  if (!access.ok) return NextResponse.json({ error: "no access to this product" }, { status: 403 });
  return { account: session.sub };
}

const isLine = (v: unknown): v is Line => LINES.includes(v as Line);

export async function GET() {
  const w = await who();
  if (w instanceof NextResponse) return w;
  const saves = await listSaves(w.account);
  return NextResponse.json({ online: saves !== null, saves: saves ?? [] }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  const w = await who();
  if (w instanceof NextResponse) return w;
  const body = (await req.json().catch(() => ({}))) as { line?: unknown; state?: unknown };
  if (!isLine(body.line)) return NextResponse.json({ error: "line must be bu1 or bu2" }, { status: 400 });
  if (typeof body.state !== "string" || !body.state) return NextResponse.json({ error: "state must be the save text" }, { status: 400 });
  if (body.state.length > MAX_STATE) return NextResponse.json({ error: "save too large" }, { status: 413 });
  try { JSON.parse(body.state); } catch { return NextResponse.json({ error: "state must be JSON" }, { status: 400 }); }
  const ok = await putSave(w.account, body.line, body.state);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "no database for this product" }, { status: 503 });
}

export async function DELETE(req: NextRequest) {
  const w = await who();
  if (w instanceof NextResponse) return w;
  const line = req.nextUrl.searchParams.get("line");
  if (!isLine(line)) return NextResponse.json({ error: "line must be bu1 or bu2" }, { status: 400 });
  const ok = await deleteSave(w.account, line);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "no database for this product" }, { status: 503 });
}
