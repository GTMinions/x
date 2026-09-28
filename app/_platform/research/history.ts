/**
 * Server-side readers for the two build artefacts the Evolvement view runs on:
 * public/topology.json and public/topology-history.json.
 *
 * They are read from disk rather than imported so that a missing artefact
 * degrades to an honest empty state instead of a build error — someone running
 * `next dev` without having run `pnpm research:history` should get a page that
 * says "run the build step", not a stack trace. `next.config.ts` traces
 * ./public/**\/* into the serverless bundle, so the read works in production too.
 *
 * Cached per process in production for the same reason engine.ts caches entities:
 * the artefacts are immutable at runtime, and re-reading a megabyte of JSON on
 * every request to re-derive the same answer is waste.
 */
import fs from "node:fs";
import path from "node:path";
import type { ProductHistory, TimedNode, TimedTopology, TopologyHistory } from "./history-types";
import type { Edge } from "./types";

const CACHE = process.env.NODE_ENV === "production";
let _history: TopologyHistory | null | undefined;
let _topology: Record<string, TimedTopology> | null | undefined;

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", file), "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadTopologyHistory(): TopologyHistory | null {
  if (CACHE && _history !== undefined) return _history;
  const v = readJson<TopologyHistory>("topology-history.json");
  if (CACHE) _history = v;
  return v;
}

export function loadTimedTopology(): Record<string, TimedTopology> | null {
  if (CACHE && _topology !== undefined) return _topology;
  const v = readJson<Record<string, TimedTopology>>("topology.json");
  if (CACHE) _topology = v;
  return v;
}

export type EvolvementData = {
  nodes: TimedNode[];
  /** The typed edge graph, for the topology view. Undated — see TopologyGraph on why. */
  edges: Edge[];
  history: ProductHistory;
  generatedAt: string;
  /** True when the artefacts came from a shallow clone — dates rest on the committed floor cache. */
  shallow: boolean;
};

/** Everything the Evolvement view needs for one product, or null if the build artefacts are missing. */
export function loadEvolvement(productSlug: string): EvolvementData | null {
  const history = loadTopologyHistory();
  const topology = loadTimedTopology();
  const product = history?.products[productSlug];
  const topo = topology?.[productSlug];
  if (!history || !product || !topo) return null;
  return {
    nodes: topo.nodes,
    edges: topo.edges,
    history: product,
    generatedAt: history.generatedAt,
    shallow: history.shallow,
  };
}
