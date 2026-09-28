/**
 * The orientation layer for a product's research index.
 *
 * Derives, from the corpus alone: the techniques it leans on hardest, the rivals
 * it names, and the maps it has drawn. Every product gets this from its own
 * content — a corpus of two dozen entities and one of several hundred go through
 * the same function and come out with different answers, which is the test of
 * whether it was derived or decided.
 */
import { loadEntities } from "./engine";
import { inboundLinks, isMap, isPlayer, isTechnique, rank, type Ranked } from "./signals";

export type Landscape = {
  techniques: Ranked[];
  players: Ranked[];
  maps: Ranked[];
  counts: { entities: number; techniques: number; players: number; maps: number };
  /** Peers below the working rung — the part of the rivalry we have not done. */
  thinPlayers: number;
};

const SHELF = 8;

export function buildLandscape(productSlug: string): Landscape {
  const entities = loadEntities(productSlug);
  const inbound = inboundLinks(productSlug);

  const techniques = entities.filter(isTechnique);
  const players = entities.filter(isPlayer);
  const maps = entities.filter(isMap);

  return {
    techniques: rank(techniques, inbound).slice(0, SHELF),
    players: rank(players, inbound).slice(0, SHELF),
    maps: rank(maps, inbound),
    counts: {
      entities: entities.length,
      techniques: techniques.length,
      players: players.length,
      maps: maps.length,
    },
    thinPlayers: players.filter((e) => e.depth_score < 7).length,
  };
}
