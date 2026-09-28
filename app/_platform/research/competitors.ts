/**
 * The competitor comparison, derived from the corpus.
 *
 * Nothing here is written by hand. The rivals are the entities the corpus files
 * as peers; the columns are what the corpus can prove about each of them; and the
 * dimensions, when a map of content covers the rivals, are that map's axes rather
 * than a fresh set invented for this page — the MOC already did that work and
 * doing it twice would produce two answers.
 *
 * The column that matters most is the one nobody asks for: which rivals we have
 * researched thinly. So the rung sits on every row, the thin ones are counted at
 * the top, and a row with no sourced number says so instead of leaving the cell
 * blank.
 */
import { loadEntities } from "./engine";
import { inboundLinks, isMap, isPlayer, outboundEdges, rank } from "./signals";
import { earnedRung, gateFor, isStale, rungFor, type Rung } from "./depth";
import type { Axis, Entity, MocMember } from "./types";

/** The number every column ultimately answers to: is this claim sourced. */
export type SourcedClaim = { metric: string; value: string; source: string };

export type CompetitorRow = {
  entity: Entity;
  inbound: number;
  rung: Rung;
  /** The rung the evidence on the page actually supports, which is not always the one it claims. */
  earned: Rung;
  overclaimed: boolean;
  stale: boolean;
  strengths: number;
  weaknesses: number;
  benchmarks: number;
  /** What the next rung is still owed. The to-do list for the thin half of the table. */
  missing: string[];
  claim: SourcedClaim | null;
  /** What the covering map asserts about this rival, when one covers it. */
  mocClaim?: MocMember;
};

export type Competitors = {
  rows: CompetitorRow[];
  /** Rivals below the `working` rung — the honest column. */
  thin: CompetitorRow[];
  /** The map whose members overlap the rivals, if the corpus has drawn one. */
  moc: Entity | null;
  axes: Axis[];
  /** Maps the corpus does have, when none of them covers the rivals. */
  otherMaps: Entity[];
  counts: {
    total: number;
    thin: number;
    /** Rivals with at least one number carrying a source. */
    sourced: number;
    /** Rivals whose depth_score claims a rung the page's own evidence does not support. */
    overclaimed: number;
  };
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Does this benchmark's value table name the entity itself? */
function ownColumn(e: Entity, values: Record<string, string>): string | null {
  const target = norm(e.name);
  for (const key of Object.keys(values)) {
    const k = norm(key);
    if (k === target || (k.length > 3 && target.includes(k)) || (target.length > 3 && k.includes(target)))
      return key;
  }
  return null;
}

/**
 * The strongest thing we can say about this rival with a receipt attached.
 *
 * Benchmarks first, because a measured number beats a described one. A benchmark
 * that names the rival in its own value table gives the rival's own figure; one
 * that does not is still a sourced measurement, and it renders as its first row
 * rather than being thrown away.
 */
function strongestClaim(e: Entity): SourcedClaim | null {
  const sourced = (e.benchmarks ?? []).filter((b) => b.source && b.values && Object.keys(b.values).length);
  const named = sourced.find((b) => ownColumn(e, b.values!));
  if (named) {
    const key = ownColumn(e, named.values!)!;
    return { metric: named.metric, value: named.values![key], source: named.source! };
  }
  if (sourced.length) {
    const b = sourced[0];
    const [key, value] = Object.entries(b.values!)[0];
    return { metric: b.metric, value: `${key} — ${value}`, source: b.source! };
  }
  for (const c of e.components ?? []) {
    const n = (c.numbers ?? []).find((x) => x.source);
    if (n) return { metric: n.label, value: n.value, source: n.source! };
  }
  return null;
}

export function buildCompetitors(productSlug: string): Competitors {
  const entities = loadEntities(productSlug);
  const inbound = inboundLinks(productSlug);
  const outbound = outboundEdges(productSlug);
  const players = entities.filter(isPlayer);
  const playerSlugs = new Set(players.map((e) => e.slug));

  // A map covers the rivals if it maps them — declared either way round, since
  // membership is written on the map (`members`) and on the member (`belongs_to`).
  const maps = entities.filter(isMap);
  const covering = maps
    .map((m) => {
      const members = (m.members ?? []).filter(
        (mem) => playerSlugs.has(mem.slug) || entities.some((e) => e.slug === mem.slug && (e.belongs_to ?? []).includes(m.slug) && isPlayer(e)),
      );
      return { map: m, members };
    })
    .filter((c) => c.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length)[0];

  const memberOf = new Map<string, MocMember>();
  for (const mem of covering?.members ?? []) memberOf.set(mem.slug, mem);

  const rows: CompetitorRow[] = rank(players, inbound).map(({ entity, inbound: inb }) => {
    // Full context, or the ladder reports a gate as failed that the entity actually
    // passes — an overclaim flag that fires on a technicality is worse than none.
    const ctx = { inbound: inb, outbound: outbound[entity.slug] ?? 0 };
    const gate = gateFor(entity, ctx);
    return {
      entity,
      inbound: inb,
      rung: rungFor(entity.depth_score),
      earned: earnedRung(entity, ctx),
      overclaimed: gate.overclaimed.length > 0,
      stale: isStale(entity),
      strengths: entity.swot?.strengths?.length ?? 0,
      weaknesses: entity.swot?.weaknesses?.length ?? 0,
      benchmarks: entity.benchmarks?.length ?? 0,
      missing: gate.unmet.map((r) => r.label),
      claim: strongestClaim(entity),
      mocClaim: memberOf.get(entity.slug),
    };
  });

  rows.sort((a, b) => b.entity.depth_score - a.entity.depth_score || a.entity.name.localeCompare(b.entity.name));
  const thin = rows.filter((r) => r.entity.depth_score < 7);

  return {
    rows,
    thin,
    moc: covering?.map ?? null,
    axes: covering?.map.axes ?? [],
    otherMaps: covering ? [] : maps,
    counts: {
      total: rows.length,
      thin: thin.length,
      sourced: rows.filter((r) => r.claim).length,
      overclaimed: rows.filter((r) => r.overclaimed).length,
    },
  };
}
