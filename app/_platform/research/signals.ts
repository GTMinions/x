/**
 * What the corpus itself says is important.
 *
 * A research site with 400 entities has no natural front page: every entity
 * thinks it is the point. The index used to answer that by listing all of them,
 * which is the same as answering nothing. This module derives the answer from the
 * corpus instead of asking anyone to write it down, so it holds for every product
 * and stays right after a research pass that nobody told the index about.
 *
 * Two signals, multiplied:
 *
 *   depth_score   how far up the ladder we took it. Effort we spent.
 *   links in      how many other pages point at it. Load the corpus puts on it.
 *
 * Either alone lies. A page can be researched to depth 10 and referenced by
 * nothing (somebody's hobby); a page can be referenced by scores of others and
 * still sit at depth 5 (a hole — `mcp` in the gtm corpus is exactly that). The
 * product of the two ranks the entities that are both deeply researched and
 * heavily leaned on, and it is those the reader wants first.
 *
 * `links in` counts three ways a page can be pointed at, because the corpus uses
 * all three and counting only edges.json would miss most of them: a typed edge, a
 * `[[slug]]` pill in someone's prose, and a `related` / `belongs_to` reference.
 */
import { loadEdges, loadEntities } from "./engine";
import type { Entity } from "./types";

const PILL_RE = /\[\[([a-z0-9-]+)\]\]/g;

/** Same cache posture as engine.ts: one pass per process in prod, re-derived in dev. */
const CACHE = process.env.NODE_ENV === "production";
const _links = new Map<string, Record<string, number>>();
const _out = new Map<string, Record<string, number>>();

/**
 * Outbound typed edges per slug. Only the depth ladder wants this — its
 * `placement` gate accepts an edge in either direction as proof that an entity
 * knows where it sits — so it counts edges alone, not pills.
 */
export function outboundEdges(productSlug: string): Record<string, number> {
  const cached = _out.get(productSlug);
  if (CACHE && cached) return cached;
  const counts: Record<string, number> = {};
  for (const edge of loadEdges(productSlug)) counts[edge.from] = (counts[edge.from] ?? 0) + 1;
  if (CACHE) _out.set(productSlug, counts);
  return counts;
}

/**
 * Inbound reference count per slug. Self-references do not count — a page citing
 * itself is not the corpus leaning on it.
 */
export function inboundLinks(productSlug: string): Record<string, number> {
  const cached = _links.get(productSlug);
  if (CACHE && cached) return cached;

  const entities = loadEntities(productSlug);
  const slugs = new Set(entities.map((e) => e.slug));
  const counts: Record<string, number> = {};
  const bump = (to: string, from: string) => {
    if (to === from || !slugs.has(to)) return;
    counts[to] = (counts[to] ?? 0) + 1;
  };

  for (const edge of loadEdges(productSlug)) bump(edge.to, edge.from);

  for (const e of entities) {
    // Pills live all over an entity — summary, positioning, section bullets,
    // component notes. Serialising the record catches them wherever they landed,
    // and one page mentioning another five times is still one page pointing at it.
    const seen = new Set<string>();
    for (const m of JSON.stringify(e).matchAll(PILL_RE)) seen.add(m[1]);
    for (const slug of seen) bump(slug, e.slug);
    for (const slug of e.related ?? []) bump(slug, e.slug);
    for (const slug of e.belongs_to ?? []) bump(slug, e.slug);
  }

  if (CACHE) _links.set(productSlug, counts);
  return counts;
}

/**
 * The corpus's own word for a competitor.
 *
 * `category: "peer"` and nothing else. The temptation is to widen this — sweep in
 * every entity whose `entity_kind` is a company and call it a competitor — and the
 * gtm corpus shows why that fails: it would file Anthropic, NVIDIA and Google as
 * competitors of a marketing agent. They are suppliers. A researcher who wrote
 * `peer` on an entity was making a claim; this reads that claim and no more.
 */
export function isPlayer(e: Entity): boolean {
  return e.category === "peer";
}

export function isMap(e: Entity): boolean {
  return e.entity_kind === "moc";
}

/**
 * A technique: something the product could build or build on, rather than someone
 * it competes with. Everything that is not a peer, not a map, not the product's
 * own internal page, and not a company.
 */
export function isTechnique(e: Entity): boolean {
  if (isMap(e) || isPlayer(e) || e.category === "internal") return false;
  return e.entity_kind !== "public" && e.entity_kind !== "private";
}

/** depth × links in. The +1 keeps a deep but unlinked page from ranking at zero. */
export function prominence(e: Entity, inbound: number): number {
  return e.depth_score * (1 + inbound);
}

export type Ranked = { entity: Entity; inbound: number; weight: number };

export function rank(entities: Entity[], inbound: Record<string, number>): Ranked[] {
  return entities
    .map((e) => ({ entity: e, inbound: inbound[e.slug] ?? 0, weight: prominence(e, inbound[e.slug] ?? 0) }))
    .sort((a, b) => b.weight - a.weight || b.entity.depth_score - a.entity.depth_score);
}
