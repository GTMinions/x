/**
 * build-topology — emit public/topology.json (per-product node/edge graph).
 *
 * The graph, plus the two things a static node/edge dump leaves out:
 *
 *   first_seen / last_changed  the node's age, from git (via build-topology-history,
 *                              which must run first). Epoch SECONDS.
 *   prose_chars                how much argument the entity actually puts in front
 *                              of a reader — see app/_platform/research/prose.ts.
 *
 * Both are HEAD-of-branch values describing the node as it stands today.
 *
 * Additive only: every field the previous version emitted is still emitted, in the
 * same shape, so existing readers of topology.json keep working.
 *
 * ── The gate ────────────────────────────────────────────────────────────────
 * This script used to write whatever it computed. A corrupt topology that still
 * writes is worse than a build that fails: the file is downstream of the research
 * content, so a dangling edge or an empty product means someone's content is
 * broken and every consumer of topology.json silently inherits it. So we check the
 * invariants FIRST and write nothing if any product fails.
 */
import fs from "node:fs";
import path from "node:path";
import { buildTopology, loadEntities } from "../app/_platform/research/engine";
import { proseChars } from "../app/_platform/research/prose";
import { topologyViolations } from "../app/_platform/research/invariants";
import type { TimedNode, TimedTopology, TopologyHistory } from "../app/_platform/research/history-types";
import type { Edge } from "../app/_platform/research/types";
import { productsWithResearch } from "./_scan";

const ROOT = process.cwd();
const HISTORY_FILE = path.join(ROOT, "public", "topology-history.json");

// ── the layout ──────────────────────────────────────────────────────────────
// Fruchterman-Reingold, run here rather than in the browser. See the docblock on
// TimedNode (history-types.ts) for why the position is a build artefact: 400 nodes
// of live simulation janks, and a layout that re-solves on every frame destroys the
// one thing the view exists to show — nodes appearing in place as time advances.

/** mulberry32. Seeded, so the layout is byte-identical on every build. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed from the product slug: different products get different starts, every build gets the same one. */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Tuned against the gtm corpus (337-node giant component, 1,150 edges), not picked
 * by eye. The objective was occupancy — how many cells of a 24×24 grid over the
 * frame contain at least one node — plus the 10th-to-90th-percentile spread and the
 * median nearest-neighbour gap, all measured on the normalised output:
 *
 *   SPREAD 1.0 (textbook FR) 143 cells · spread .448 · median NN gap .0131
 *   SPREAD 1.3               152 cells · spread .540 · median NN gap .0152   ← this
 *   SPREAD 1.6               140 cells · spread .474 · median NN gap .0138
 *   SPREAD 2.1               132 cells · spread .438 · median NN gap .0128
 *
 * Repulsion beyond ~1.3 backfires, which is worth knowing: the extra push does not
 * inflate the core, it flings the loosely-attached tendrils further out, and since
 * the layout is normalised to its own bounding box the core is then scaled back
 * down. Past that point, turning repulsion up makes the hairball tighter.
 */
const ITERATIONS = 400;
const SIDE = 1000;      // layout box; normalised away at the end
const GRAVITY = 0.015;  // holds the component together against its own repulsion
const SPREAD = 1.3;     // repulsion's ideal length, as a multiple of attraction's
const RING_R = 0.475;   // where the unlinked belt sits, in normalised units
const RING_CAP = 96;    // nodes per belt ring before a second ring is needed
type Pt = { x: number; y: number };

/** Connected components over the undirected edge set, largest first, deterministic. */
function components(slugs: string[], edges: Edge[]): string[][] {
  const adj = new Map<string, string[]>(slugs.map((s) => [s, []]));
  for (const e of edges) {
    if (e.from === e.to || !adj.has(e.from) || !adj.has(e.to)) continue;
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const s of slugs) {
    if (seen.has(s)) continue;
    const stack = [s];
    seen.add(s);
    const comp: string[] = [];
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const nb of adj.get(cur)!) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
    }
    out.push(comp.sort());
  }
  // Size desc, then first slug — ties must not depend on traversal order.
  return out.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/** Fruchterman-Reingold over one connected component. Raw coordinates in a SIDE box. */
function fr(order: string[], edges: Edge[], rnd: () => number): Map<string, Pt> {
  const n = order.length;
  const idx = new Map(order.map((s, i) => [s, i]));
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Seed on a disc, not a square: a square start biases the corners.
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * SIDE * 0.4;
    px[i] = SIDE / 2 + Math.cos(a) * r;
    py[i] = SIDE / 2 + Math.sin(a) * r;
  }

  const ea: number[] = [];
  const eb: number[] = [];
  for (const e of edges) {
    const a = idx.get(e.from);
    const b = idx.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    ea.push(a);
    eb.push(b);
  }

  const k = Math.sqrt((SIDE * SIDE) / n); // ideal edge length

  /**
   * Repulsion gets a longer ideal length than attraction.
   *
   * Textbook Fruchterman-Reingold uses one `k` for both, which is right for a
   * sparse graph and wrong for this one: 349 connected entities averaging ~7 edges
   * each pull far harder than they push, and the result collapses into a hairball
   * that is a picture of a graph rather than a readable one. Giving repulsion a
   * longer reach separates the clusters without changing where the edges want to
   * be, so the structure the edges encode survives and becomes visible.
   */
  const kRepel = k * SPREAD;

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    dx.fill(0);
    dy.fill(0);

    // Repulsion, every pair: kRepel²/d along the unit vector = kRepel²/d² on the raw
    // vector. O(n²) — 337 nodes is 57k pairs, cheap enough at build time that a
    // Barnes-Hut approximation would only add a bug surface.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = px[i] - px[j];
        let vy = py[i] - py[j];
        let d2 = vx * vx + vy * vy;
        if (d2 < 0.01) {
          // Coincident nodes have no direction to separate along. Nudge from the
          // seeded stream so even the tie-break is reproducible.
          vx = (rnd() - 0.5) * 0.1;
          vy = (rnd() - 0.5) * 0.1;
          d2 = vx * vx + vy * vy;
        }
        const f = (kRepel * kRepel) / d2;
        dx[i] += vx * f;
        dy[i] += vy * f;
        dx[j] -= vx * f;
        dy[j] -= vy * f;
      }
    }

    // Attraction along edges: d²/k along the unit vector = d/k on the raw vector.
    for (let m = 0; m < ea.length; m++) {
      const i = ea[m];
      const j = eb[m];
      const vx = px[i] - px[j];
      const vy = py[i] - py[j];
      const d = Math.sqrt(vx * vx + vy * vy) || 0.01;
      const f = d / k;
      dx[i] -= vx * f;
      dy[i] -= vy * f;
      dx[j] += vx * f;
      dy[j] += vy * f;
    }

    // Cool linearly: early iterations move far and untangle, late ones settle.
    const temp = (SIDE / 10) * (1 - iter / ITERATIONS);
    for (let i = 0; i < n; i++) {
      dx[i] += (SIDE / 2 - px[i]) * GRAVITY;
      dy[i] += (SIDE / 2 - py[i]) * GRAVITY;
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const step = Math.min(d, temp);
      px[i] += (dx[i] / d) * step;
      py[i] += (dy[i] / d) * step;
    }
  }

  const out = new Map<string, Pt>();
  for (let i = 0; i < n; i++) out.set(order[i], { x: px[i], y: py[i] });
  return out;
}

/**
 * Positions on the unit square, uniformly scaled so a square viewBox renders the
 * shape true (independent per-axis normalisation would stretch a tall graph
 * sideways and lie about it).
 *
 * Components are packed, not simulated together. Run one FR over all 408 gtm nodes
 * and the 59 entities with no edges at all feel repulsion and no attraction: they
 * fly out to a far ring, the bounding box triples, and the 337-node component that
 * carries every actual relationship is normalised down into ~10% of the frame — an
 * unreadable blot surrounded by dust. So the giant component gets the frame, and
 * everything disconnected from it goes in a belt around the outside.
 *
 * The belt is not a claim. An entity with no edges has no adjacency to honour, so
 * its position carries no information — and ringing them makes the one real fact
 * about them ("nothing links here") visible instead of hiding it in the blot.
 */
function forceLayout(product: string, nodes: { slug: string }[], edges: Edge[]): Map<string, Pt> {
  const out = new Map<string, Pt>();
  const n = nodes.length;
  if (n === 0) return out;
  if (n === 1) return out.set(nodes[0].slug, { x: 0.5, y: 0.5 });

  // Sort by slug, never readdir order: the layout must not depend on the filesystem's mood.
  const slugs = nodes.map((x) => x.slug).sort();
  const rnd = mulberry32(seedOf(product));
  const comps = components(slugs, edges);
  const giant = comps[0].length > 1 ? comps[0] : [];
  const inGiant = new Set(giant);
  const belt = comps.filter((c) => c !== comps[0] || giant.length === 0).flat();

  const r4 = (v: number) => Math.round(v * 10000) / 10000; // 4dp keeps topology.json's diff readable

  if (giant.length) {
    const raw = fr(giant, edges.filter((e) => inGiant.has(e.from) && inGiant.has(e.to)), rnd);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of raw.values()) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    // With a belt to clear, the core keeps to the middle; without one it takes the frame.
    const scale = belt.length ? 0.64 : 0.94;
    const offX = (span - (maxX - minX)) / 2;
    const offY = (span - (maxY - minY)) / 2;
    for (const [slug, p] of raw) {
      out.set(slug, {
        x: r4(0.5 - scale / 2 + ((p.x - minX + offX) / span) * scale),
        y: r4(0.5 - scale / 2 + ((p.y - minY + offY) / span) * scale),
      });
    }
  }

  // The belt: component members stay contiguous, so a small component's edges draw
  // as short chords rather than lines across the whole picture.
  const rings = Math.max(1, Math.ceil(belt.length / RING_CAP));
  for (let i = 0; i < belt.length; i++) {
    const ring = i % rings;
    const seat = Math.floor(i / rings);
    const seats = Math.ceil((belt.length - ring) / rings);
    const a = (seat / Math.max(1, seats)) * Math.PI * 2 - Math.PI / 2;
    const r = RING_R - ring * 0.055;
    out.set(belt[i], { x: r4(0.5 + Math.cos(a) * r), y: r4(0.5 + Math.sin(a) * r) });
  }

  return out;
}

function loadHistory(): TopologyHistory | null {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as TopologyHistory;
  } catch {
    return null;
  }
}

const history = loadHistory();
if (!history) {
  console.warn(
    "  ! public/topology-history.json missing — nodes will carry first_seen/last_changed = 0.\n" +
      "    Run `pnpm research:history` (the `build` script already does, before this one).",
  );
}

const nowSec = Math.floor(Date.now() / 1000);
const out: Record<string, TimedTopology> = {};
const failures: string[] = [];
let layoutTotalMs = 0;

for (const product of productsWithResearch()) {
  const base = buildTopology(product);
  const entities = loadEntities(product);
  const prose = new Map(entities.map((e) => [e.slug, proseChars(e)]));
  const hist = history?.products[product]?.entities ?? {};

  const t0 = performance.now();
  const pos = forceLayout(product, base.nodes, base.edges);
  const layoutMs = performance.now() - t0;
  layoutTotalMs += layoutMs;

  const nodes: TimedNode[] = base.nodes.map((n) => {
    const h = hist[n.slug];
    const p = pos.get(n.slug) ?? { x: 0.5, y: 0.5 };
    return {
      ...n,
      // No history entry means the entity file is newer than the last history
      // build. "Now" is the honest answer — it is the earliest moment we can
      // prove it existed — and it is what the history script would say too.
      first_seen: h?.first_seen ?? nowSec,
      last_changed: h?.last_changed ?? nowSec,
      prose_chars: prose.get(n.slug) ?? 0,
      x: p.x,
      y: p.y,
    };
  });

  const topo: TimedTopology = { ...base, nodes };
  const problems = topologyViolations(topo);
  if (problems.length) {
    failures.push(...problems.map((p) => `${product}: [${p.code}] ${p.detail}`));
    console.log(`  ✗ ${product}: ${problems.length} invariant violation(s)`);
    continue;
  }

  out[product] = topo;
  const chars = nodes.reduce((n, x) => n + x.prose_chars, 0);
  console.log(
    `  ✓ ${product}: ${nodes.length} nodes, ${topo.edges.length} edges, ${(chars / 1000).toFixed(0)}k chars of prose` +
      ` · layout ${ITERATIONS} iters in ${layoutMs.toFixed(0)}ms`,
  );
}

if (failures.length) {
  console.error(`\n✗ build-topology: ${failures.length} invariant violation(s) — nothing written.\n`);
  for (const f of failures) console.error(`  - ${f}`);
  throw new Error("topology invariants failed");
}

const pub = path.join(ROOT, "public");
fs.mkdirSync(pub, { recursive: true });
fs.writeFileSync(path.join(pub, "topology.json"), JSON.stringify(out, null, 2));
console.log(`✓ build-topology → public/topology.json · ${layoutTotalMs.toFixed(0)}ms in layout`);
