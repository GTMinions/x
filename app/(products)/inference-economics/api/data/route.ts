/** GET /inference-economics/api/data — the game's world, from the product's database (seeded on first call). */
import { NextResponse } from "next/server";

import { getSession } from "@/app/lib/auth";
import { readProductOrDenial } from "@/app/lib/access";
import { GAME_SLUG } from "../../data/schema";
import { loadGameData } from "../../_db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const access = await readProductOrDenial(session?.email, GAME_SLUG);
  if (!access.ok) return NextResponse.json({ error: "no access to this product" }, { status: 403 });
  const data = await loadGameData();
  if (!data) return NextResponse.json({ error: "this product has no database yet — load it from /setup" }, { status: 503 });
  return NextResponse.json(data, { headers: { "cache-control": "private, max-age=60" } });
}
