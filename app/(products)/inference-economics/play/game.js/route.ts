/** GET /inference-economics/play/game.js — the game's code, one file, cached. */
import { NextResponse } from "next/server";

import { GAME_JS, GAME_JS_HASH } from "../../_game/bundle";

export const dynamic = "force-static";

export async function GET() {
  return new NextResponse(GAME_JS, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=300, must-revalidate",
      etag: `"${GAME_JS_HASH}"`,
    },
  });
}
