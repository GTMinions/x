/**
 * /inference-economics/api/runs — finished games.
 *
 *   POST { line, rank, score, summary }   record the run that just ended
 *   GET                                    the best runs per line
 */
import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/app/lib/auth";
import { readProductOrDenial } from "@/app/lib/access";
import { GAME_SLUG } from "../../data/schema";
import { recordRun, topRuns, LINES, type Line } from "../../_db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const access = await readProductOrDenial(session?.email, GAME_SLUG);
  if (!access.ok) return NextResponse.json({ error: "no access to this product" }, { status: 403 });
  return NextResponse.json(await topRuns(), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.sub) return NextResponse.json({ error: "sign in to record a run" }, { status: 401 });
  const access = await readProductOrDenial(session.email, GAME_SLUG);
  if (!access.ok) return NextResponse.json({ error: "no access to this product" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { line?: unknown; rank?: unknown; score?: unknown; summary?: unknown };
  if (!LINES.includes(body.line as Line)) return NextResponse.json({ error: "line must be bu1 or bu2" }, { status: 400 });
  const rank = String(body.rank ?? "");
  if (!/^[SABCD]$/.test(rank)) return NextResponse.json({ error: "rank must be S, A, B, C or D" }, { status: 400 });
  const score = Number(body.score);
  if (!Number.isFinite(score)) return NextResponse.json({ error: "score must be a number" }, { status: 400 });
  const summary = body.summary && typeof body.summary === "object" ? (body.summary as Record<string, unknown>) : {};
  if (JSON.stringify(summary).length > 20_000) return NextResponse.json({ error: "summary too large" }, { status: 413 });

  const display = (session.name || session.email?.split("@")[0] || "player").slice(0, 40);
  const ok = await recordRun({ account: session.sub, display, line: body.line as Line, rank, score, summary });
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "no database for this product" }, { status: 503 });
}
