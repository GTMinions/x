/**
 * Corpus history — the time dimension of the research graph.
 *
 * `topology.json` answers "what does the corpus look like." This answers "how did
 * it get that way," and the only witness we have is git. That constrains what may
 * be claimed here, so the constraint is written into the types:
 *
 *   DERIVABLE from git alone (and therefore in this model)
 *     · when an entity file first appeared              → first_seen
 *     · when it was last written to                     → last_changed
 *     · how many lines each commit added / removed      → HistoryEvent
 *     · the commit subject that did it                  → HistoryEvent.subject
 *     · how many edges were wired at a given commit     → EdgeCountPoint
 *       (edges.json is one small file, so the historical blob is read back and
 *        its edges counted — a measurement, not an estimate)
 *
 *   NOT derivable without reading every historical blob (and therefore absent)
 *     · an entity's depth_score at time T
 *     · its citation count at time T
 *     · its rendered prose length at time T
 *
 * `prose_chars` on a node is a **HEAD-only** figure: the entity as it stands
 * today. There is no `prose_chars` on a HistoryEvent, because git gives us
 * changed *lines of JSON*, which is not the same quantity and must not be dressed
 * up as if it were.
 *
 * Types only — no `fs`, so a client component can import them. The loaders live
 * in ./history (server) and the generator in scripts/build-topology-history.ts.
 */
import type { Topology, TopologyNode } from "./types";

/** One commit that touched one entity file. */
export type HistoryEvent = {
  ts: number;                   // author date, epoch SECONDS
  sha: string;                  // "" for a file that exists on disk but not in git
  added: number;                // lines of JSON added (numstat)
  removed: number;              // lines of JSON removed
  subject: string;              // commit subject line
};

export type SlugHistory = {
  /** Epoch seconds. From the product database when the corpus lives there; else git, floored by the pulled timestamps. */
  first_seen: number;
  /** Epoch seconds. Same source as first_seen. */
  last_changed: number;
  commits: number;
  /** Ascending by ts. Empty when the file has never been committed. */
  events: HistoryEvent[];
  /** True when git has no record of this file at all — first_seen is "now", not a measurement. */
  uncommitted?: boolean;
};

/** Edge count read back from the edges.json blob at a commit. Measured, not inferred. */
export type EdgeCountPoint = { ts: number; sha: string; count: number };

export type ProductHistory = {
  /** False when git has no history for this product's content at all (e.g. never committed). */
  tracked: boolean;
  entities: Record<string, SlugHistory>;
  /** Ascending by ts. Empty when edges.json has no committed history. */
  edgeTimeline: EdgeCountPoint[];
};

export type TopologyHistory = {
  generatedAt: string;
  /** True if generated in a shallow clone — the git-derived floor is then incomplete by construction. */
  shallow: boolean;
  products: Record<string, ProductHistory>;
};

/**
 * The floor under git's view: per product, each entity's first_seen / last_changed
 * as the product database records them (pulled to research/content/_timestamps.json).
 * For a product whose corpus lives in the database this is the whole record —
 * git never saw the file. For one whose corpus is in git it caps what a shallow
 * clone can regress.
 */
export type TimestampCache = Record<string, Record<string, { first_seen: number; last_changed: number }>>;

/** A topology node with the time + volume fields build-topology attaches. All HEAD-of-branch values. */
export type TimedNode = TopologyNode & {
  first_seen: number;
  last_changed: number;
  /** Characters of reader-visible prose in the entity file *today*. Not a time series. */
  prose_chars: number;
  /**
   * Position in the force layout, normalised to 0..1 (uniformly scaled, so the
   * unit square is undistorted and a square viewBox renders it true).
   *
   * Computed at BUILD time, from a seeded PRNG, for two reasons:
   *
   *   determinism — a layout seeded on Math.random moves every deploy, so a node
   *     the reader learned the position of is somewhere else tomorrow. Seeded, the
   *     same corpus lays out identically forever, and a diff of topology.json shows
   *     only what actually changed.
   *   stability under scrubbing — because a node's coordinates do not depend on
   *     which other nodes are visible, dragging the time cursor makes nodes APPEAR
   *     IN PLACE instead of reshuffling the whole graph. Watching it grow is the
   *     point; a live simulation would re-solve the layout on every frame and the
   *     growth would be lost inside the churn.
   *
   * Layout coordinates only. They carry no meaning beyond adjacency — x is not a
   * date, y is not a score. Nothing should be read off an axis.
   */
  x: number;
  y: number;
};

export type TimedTopology = Omit<Topology, "nodes"> & { nodes: TimedNode[] };
