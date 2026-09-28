/**
 * Research engine — loads a product's research content from disk and builds the
 * derived structures (index, topology, search) the research site renders from.
 *
 * Content lives at app/(products)/<slug>/research/content/:
 *   entities/*.json   — one Entity per file
 *   edges.json        — { edges: Edge[] }   (optional)
 *
 * This is the shared "large site" engine: it is product-agnostic. Point it at a
 * product slug and it produces that product's research site. Runs at build /
 * request time in the Node (server) runtime via fs.
 */
import fs from "node:fs";
import path from "node:path";
import type { Entity, Edge, Topology, TopologyNode } from "./types";

export function contentDir(productSlug: string): string {
  // Route-group folders keep their literal parens on disk.
  return path.join(process.cwd(), "app", "(products)", productSlug, "research", "content");
}

export function hasContent(productSlug: string): boolean {
  try {
    return fs.existsSync(path.join(contentDir(productSlug), "entities"));
  } catch {
    return false;
  }
}

/**
 * Parsed entities, cached per product. Content is read-only at runtime, so in
 * production one parse per process is enough — a large research site is hundreds
 * of files and every page render would otherwise re-read all of them. Dev skips
 * the cache so editing an entity JSON shows up on reload.
 */
const _entityCache = new Map<string, Entity[]>();
const CACHE_ENTITIES = process.env.NODE_ENV === "production";

export function loadEntities(productSlug: string): Entity[] {
  const cached = _entityCache.get(productSlug);
  if (CACHE_ENTITIES && cached) return cached;

  const dir = path.join(contentDir(productSlug), "entities");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const entities: Entity[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      const e = JSON.parse(raw) as Entity;
      if (e && e.slug) entities.push(e);
    } catch (err) {
      console.error(`[research.engine] bad entity ${productSlug}/${f}:`, err);
    }
  }
  entities.sort((a, b) => b.depth_score - a.depth_score || a.name.localeCompare(b.name));
  if (CACHE_ENTITIES) _entityCache.set(productSlug, entities);
  return entities;
}

export function loadEntity(productSlug: string, slug: string): Entity | null {
  return loadEntities(productSlug).find((e) => e.slug === slug) ?? null;
}

export function loadEdges(productSlug: string): Edge[] {
  const file = path.join(contentDir(productSlug), "edges.json");
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as { edges?: Edge[] };
    return Array.isArray(parsed.edges) ? parsed.edges : [];
  } catch {
    return [];
  }
}

/** Set of resolvable slugs, used to mark [[pills]] internal vs dead. */
export function entitySlugSet(productSlug: string): Set<string> {
  return new Set(loadEntities(productSlug).map((e) => e.slug));
}

export function buildTopology(productSlug: string): Topology {
  const entities = loadEntities(productSlug);
  const edges = loadEdges(productSlug);
  const inbound: Record<string, number> = {};
  const outbound: Record<string, number> = {};
  for (const e of edges) {
    outbound[e.from] = (outbound[e.from] ?? 0) + 1;
    inbound[e.to] = (inbound[e.to] ?? 0) + 1;
  }
  const nodes: TopologyNode[] = entities.map((e) => ({
    slug: e.slug,
    name: e.name,
    category: e.category,
    depth_score: e.depth_score,
    inbound: inbound[e.slug] ?? 0,
    outbound: outbound[e.slug] ?? 0,
  }));
  const depthHistogram: Record<string, number> = {};
  for (const e of entities) {
    const bucket = String(Math.min(10, Math.max(0, Math.round(e.depth_score))));
    depthHistogram[bucket] = (depthHistogram[bucket] ?? 0) + 1;
  }
  return {
    product: productSlug,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    depthHistogram,
  };
}

/**
 * One searchable entity.
 *
 * `depth` and `kind` ride along because a result list without them is a list of
 * names: on a corpus that is mostly stubs, "we have a page on it" and "we know
 * something about it" are very different answers, and the reader deserves to see
 * which one they are getting before they click.
 */
export type SearchDoc = {
  slug: string;
  name: string;
  subtitle?: string;
  tags?: string[];
  depth: number;
  kind?: string;
  text: string;
};

export function buildSearchIndex(productSlug: string): SearchDoc[] {
  return loadEntities(productSlug).map((e) => ({
    slug: e.slug,
    name: e.name,
    subtitle: e.subtitle,
    tags: e.tags,
    depth: e.depth_score,
    kind: e.entity_kind,
    text: [
      e.summary,
      e.positioning,
      e.architecture_summary,
      e.thesis,
      ...(e.key_takeaways ?? []),
      ...(e.swot?.strengths ?? []),
      ...(e.swot?.opportunities ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 4000),
  }));
}

/** Edges grouped for one entity's page (both directions). */
export function relationsFor(productSlug: string, slug: string): { out: Edge[]; in: Edge[] } {
  const edges = loadEdges(productSlug);
  return {
    out: edges.filter((e) => e.from === slug),
    in: edges.filter((e) => e.to === slug),
  };
}
