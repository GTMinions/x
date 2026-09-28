/**
 * Architecture — the bridge between the research corpus and the built product.
 *
 * The research site answers "what is this thing." The architecture answers
 * "what did we build out of it." A **Layer** is a horizontal slice of the system:
 * it names what it does, the commitment it makes to whoever depends on it, the
 * layers beneath it, and — the load-bearing part — the research entities it rests
 * on.
 *
 * That last field is what stops an architecture page from being a drawing. Every
 * slug in `entities` resolves against the product's own research corpus (the
 * validator fails the build otherwise), so each layer inherits the depth of the
 * research under it. A layer whose entities all sit below the `working` rung is a
 * layer whose claims nobody has earned the right to make. `defenceFor` computes
 * that, and the page prints it.
 *
 * Content is per-product and optional:
 *   app/(products)/<slug>/research/content/architecture.json
 *   { "product": { "layers": [...] }, "technical": { "layers": [...] } }
 *
 * The two views take the same shape and differ in register. `product` is what the
 * system does for the person using it. `technical` is how it is put together.
 */
import fs from "node:fs";
import path from "node:path";
import { contentDir, loadEntities } from "./engine";
import { laddersFor, rungFor } from "./depth";
import type { Entity, Rung, RungLabel } from "./types";

export type ViewName = "product" | "technical";
export const VIEWS: ViewName[] = ["product", "technical"];

export type Layer = {
  /** Unique within its view. Used as the depends_on target. */
  slug: string;
  name: string;
  /** What this layer does, in one line. */
  one_line: string;
  /** What this layer promises to whatever sits above it. The falsifiable part. */
  commitment: string;
  /** Other layer slugs in the SAME view that this one stands on. */
  depends_on?: string[];
  /** Research entity slugs this layer is built on or evaluated against. Must resolve. */
  entities: string[];
  /** Where the product does not yet do the thing, say so here. */
  open_question?: string;
};

export type ArchitectureView = { layers: Layer[] };
export type Architecture = { product?: ArchitectureView; technical?: ArchitectureView };

/**
 * The rungs that count as defensible research.
 *
 * `working` is the first rung that requires a mechanism and a number with a
 * receipt (see ./depth). Below it, an entity is a position with a citation — fine
 * as reading, too thin to build a promise on.
 */
const DEFENSIBLE: RungLabel[] = ["working", "reference"];

export function architectureFile(productSlug: string): string {
  return path.join(contentDir(productSlug), "architecture.json");
}

const _cache = new Map<string, Architecture | null>();
const CACHE = process.env.NODE_ENV === "production";

/** Null when the product has no architecture.json. Absence is legal, not an error. */
export function loadArchitecture(productSlug: string): Architecture | null {
  if (CACHE && _cache.has(productSlug)) return _cache.get(productSlug) ?? null;

  let parsed: Architecture | null = null;
  try {
    const raw = fs.readFileSync(architectureFile(productSlug), "utf8");
    parsed = JSON.parse(raw) as Architecture;
  } catch (err: unknown) {
    // A missing file is the empty state. A malformed one is a content bug worth shouting about.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.error(`[research.architecture] bad architecture.json for ${productSlug}:`, err);
    }
    parsed = null;
  }
  if (CACHE) _cache.set(productSlug, parsed);
  return parsed;
}

export function hasArchitecture(productSlug: string): boolean {
  const a = loadArchitecture(productSlug);
  return Boolean(a?.product?.layers?.length || a?.technical?.layers?.length);
}

/** The layers of one view, in stack order: index 0 is the top, closest to the reader. */
export function layersFor(productSlug: string, view: ViewName): Layer[] {
  return loadArchitecture(productSlug)?.[view]?.layers ?? [];
}

/** One entity under a layer, resolved against the corpus and graded. */
export type LayerEntity = {
  slug: string;
  /** Null only if the validator was bypassed — the build gate makes this unreachable in CI. */
  entity: Entity | null;
  rung: Rung | null;
  defensible: boolean;
};

export type LayerDefence = {
  layer: Layer;
  entities: LayerEntity[];
  /** How many of the layer's entities have reached `working` or above. */
  defensibleCount: number;
  /**
   * True when a layer rests on research and none of it has reached `working`.
   * The claim on such a layer is a claim we cannot currently defend.
   */
  undefended: boolean;
};

/**
 * Grade one layer against the corpus.
 *
 * The judgement is deliberately blunt: a single entity at `working` defends the
 * layer. The point is not to score the architecture, it is to catch the layer
 * where nothing underneath it has a mechanism and a sourced number.
 */
export function defenceFor(productSlug: string, layer: Layer): LayerDefence {
  const corpus = loadEntities(productSlug);
  const bySlug = new Map(corpus.map((e) => [e.slug, e]));

  const entities: LayerEntity[] = layer.entities.map((slug) => {
    const entity = bySlug.get(slug) ?? null;
    const rung = entity ? rungFor(entity.depth_score, laddersFor(entity)) : null;
    return { slug, entity, rung, defensible: Boolean(rung && DEFENSIBLE.includes(rung.label)) };
  });

  const defensibleCount = entities.filter((e) => e.defensible).length;
  return {
    layer,
    entities,
    defensibleCount,
    undefended: entities.length > 0 && defensibleCount === 0,
  };
}

export function defencesFor(productSlug: string, view: ViewName): LayerDefence[] {
  return layersFor(productSlug, view).map((l) => defenceFor(productSlug, l));
}
