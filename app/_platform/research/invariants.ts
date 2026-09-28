/**
 * The invariants a research topology must satisfy to be worth writing.
 *
 * These live in the spine rather than inside build-topology because the property
 * they protect is a property of the *graph*, not of the script that happens to
 * serialise it — anything that produces a topology (the build, the export API)
 * should be able to ask the same question.
 *
 * The rule: a silently-corrupt topology that still writes is worse than a build
 * that fails. topology.json sits downstream of hand-authored research content, so
 * a dangling edge means an entity was renamed or deleted and its edges were left
 * pointing at a ghost. Written out, that ghost propagates to every consumer, and
 * the first person to notice is a reader following a link to nowhere.
 */
import type { Edge, TopologyNode } from "./types";

export type Invariant = { code: "empty" | "self-loop" | "dangling-from" | "dangling-to"; detail: string };

/**
 * Every violation in one product's graph — all of them, not just the first. A
 * build that fails one dangling edge at a time costs one build per broken edge.
 */
export function topologyViolations(graph: { nodes: TopologyNode[]; edges: Edge[] }): Invariant[] {
  const found: Invariant[] = [];
  const known = new Set(graph.nodes.map((n) => n.slug));

  if (graph.nodes.length === 0) {
    found.push({
      code: "empty",
      detail: "zero nodes — there is a content/entities dir, but nothing parsed out of it",
    });
  }

  for (const e of graph.edges) {
    if (e.from === e.to) {
      found.push({ code: "self-loop", detail: `${e.from} --${e.rel}--> itself` });
      continue; // a self-loop on an unknown slug is one bug, not three
    }
    if (!known.has(e.from)) {
      found.push({ code: "dangling-from", detail: `"${e.from}" (no such entity) --${e.rel}--> ${e.to}` });
    }
    if (!known.has(e.to)) {
      found.push({ code: "dangling-to", detail: `${e.from} --${e.rel}--> "${e.to}" (no such entity)` });
    }
  }

  return found;
}
