/**
 * GET /inference-economics/play — the game itself, a self-contained page the
 * product's overview embeds in a frame. The frame is deliberate: the game
 * is a fixed 16:9 stage that scales itself to the window, opens overlays that
 * cover everything, and listens at document level — all of which it does
 * unchanged inside its own document, and none of which the site's chrome
 * would survive.
 *
 * The source is _game/index.html and _game/game.js, embedded as strings by
 * `pnpm game:embed` (see _game/bundle.ts) so the page needs no file system
 * at request time.
 */
import { NextResponse } from "next/server";

import { getSession } from "@/app/lib/auth";
import { readProductOrDenial } from "@/app/lib/access";
import { GAME_SLUG } from "../data/schema";
import { GAME_HTML } from "../_game/bundle";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const access = await readProductOrDenial(session?.email, GAME_SLUG);
  if (!access.ok) return new NextResponse("no access to this product", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new NextResponse(GAME_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      // Only this site may frame it.
      "content-security-policy": "frame-ancestors 'self'",
    },
  });
}
