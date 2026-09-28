/**
 * Inference Economics — the product page IS the game: everything under the
 * product header is the frame (see play/route.ts for why a frame). The
 * leaderboard and saves live in the product's database behind api/.
 */
import { ProductShell } from "@/app/_platform/ProductShell";
import { GAME_SLUG } from "./data/schema";
import { GameFrame } from "./GameFrame";
import { t as copyText } from "@/app/_platform/copy";

export const dynamic = "force-dynamic";

export default async function InferenceEconomicsHome() {
  return (
    <ProductShell slug={GAME_SLUG} active="" full>
      <GameFrame src="/inference-economics/play" title={copyText("inference-economics.home.title-1")} />
    </ProductShell>
  );
}
