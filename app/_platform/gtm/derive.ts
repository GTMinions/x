/**
 * Derive the launch scaffold from the research corpus.
 *
 * The premise of the whole platform: if the research is good, the go-to-market is
 * largely *already written* — it is just filed under different names.
 *
 *   a benchmark            is a proof point
 *   a MOC's axes           are the competitive frame
 *   a MOC's members        are the alternatives the buyer is actually weighing
 *   a voice                is evidence a segment exists, in their own words
 *   an incident            is the reason the status quo is expensive
 *   an entity's mechanism  is the answer to "but how"
 *
 * So this does not *invent* GTM. It reads the corpus and proposes the claims the
 * evidence will support — then refuses to propose the ones it won't. What comes
 * out is a draft with receipts attached, which a human then argues with.
 *
 * Nothing here writes copy. A claim's `text` is assembled from the entity's own
 * words; if the corpus never said it, the platform will not say it either.
 */
import { loadEntities } from "../research/engine";
import { loadVoices, loadBenchmarkRows, loadIncidents } from "../research/substrates";
import { gateFor } from "../research/depth";
import type { Entity } from "../research/types";
import type { Claim, Audience, LaunchPlan } from "./types";

/** Claims a benchmark can support: a measured number with its receipt. */
function claimsFromBenchmarks(product: string): Claim[] {
  const out: Claim[] = [];
  for (const b of loadBenchmarkRows(product)) {
    if (!b.source_url) continue; // no receipt, no claim — this is the whole discipline
    out.push({
      id: `bench:${b.id}`,
      text: `${b.metric}: ${b.value}`,
      kind: "benchmark",
      entity_slug: b.entity_slug,
      citation: { label: b.backs_claim || b.metric, url: b.source_url, date: b.source_date },
      falsifier: `Re-run the measurement. If ${b.metric} does not reproduce at ${b.value}, the claim is dead.`,
    });
  }
  return out;
}

/**
 * Claims an entity can support.
 *
 * Only from entities at `working` or above. An entity below that rung has not
 * established a mechanism or grounded a number — it is a page of assertions, and
 * a marketing claim resting on it would inherit that. This is the depth ladder
 * doing load-bearing work outside research for the first time: **the rung an
 * entity has reached decides whether you are allowed to sell from it.**
 */
function claimsFromEntities(product: string, entities: Entity[]): Claim[] {
  const out: Claim[] = [];
  for (const e of entities) {
    if (e.entity_kind === "moc") continue;
    const gate = gateFor(e);
    if (gate.current.label !== "working" && gate.current.label !== "reference") continue;
    if (gate.overclaimed.length > 0) continue; // it does not even hold up its own score

    // A number with a source on it is the strongest thing an entity carries.
    for (const c of e.components ?? []) {
      for (const n of c.numbers ?? []) {
        if (!n.source) continue;
        out.push({
          id: `num:${e.slug}:${c.name}:${n.label}`.replace(/\s+/g, "-").toLowerCase(),
          text: `${n.label} — ${n.value}`,
          kind: "entity",
          entity_slug: e.slug,
          citation: { label: `${e.name} · ${c.name}`, url: n.source },
          falsifier: `Check ${n.label} against the source. A different value kills the claim.`,
        });
      }
    }

    // The recommendation is the one opinion the entity page already committed to.
    if (e.recommendation?.trim() && (e.citations?.length ?? 0) > 0) {
      out.push({
        id: `rec:${e.slug}`,
        text: e.recommendation.trim(),
        kind: "entity",
        entity_slug: e.slug,
        citation: e.citations![0],
        falsifier: e.open_questions?.[0] ?? "Name the evidence that would reverse this recommendation.",
      });
    }
  }
  return out;
}

/** An incident is the cost of the status quo, and it is dated. */
function claimsFromIncidents(product: string): Claim[] {
  return loadIncidents(product)
    .filter((i) => i.source_url && i.lesson)
    .map((i) => ({
      id: `incident:${i.id}`,
      text: i.lesson!,
      kind: "incident" as const,
      citation: { label: i.title, url: i.source_url, date: i.source_date },
      falsifier: "Show the incident did not happen, or that the lesson does not generalise.",
    }));
}

/**
 * Audiences, from what named people actually said in public.
 *
 * A segment invented in a workshop is a hypothesis. A segment built from a voice
 * — a real person, named, with a link — is a hypothesis with one data point,
 * which is strictly better and is honest about being only one.
 */
function audiencesFromVoices(product: string): Audience[] {
  const byTag = new Map<string, { who: string; id: string }[]>();
  for (const v of loadVoices(product)) {
    if (!v.who || !v.tag) continue;
    const list = byTag.get(v.tag) ?? [];
    list.push({ who: v.who, id: v.id });
    byTag.set(v.tag, list);
  }
  return [...byTag.entries()].map(([tag, people]) => ({
    id: `aud:${tag}`,
    name: tag,
    jtbd: `Named in public by ${people.map((p) => p.who).slice(0, 3).join(", ")}.`,
    alternative: "Not yet established — ask them what they do today instead.",
    objection: "Not yet established — the corpus records the pain, not the objection.",
    voices: people.map((p) => p.id),
  }));
}

/**
 * The competitive frame, straight out of the MOC.
 *
 * A map of content already did this work: it named the axes the field splits on
 * and took a position on every member. That IS a competitive matrix — it was just
 * filed as research.
 */
export type CompetitiveFrame = {
  moc_slug: string;
  thesis: string;
  axes: { name: string; question: string }[];
  alternatives: { slug: string; claim: string; source?: string }[];
};

export function competitiveFrames(product: string): CompetitiveFrame[] {
  return loadEntities(product)
    .filter((e) => e.entity_kind === "moc" && e.thesis && (e.members?.length ?? 0) >= 3)
    .map((e) => ({
      moc_slug: e.slug,
      thesis: e.thesis!,
      axes: (e.axes ?? []).map((a) => ({ name: a.name, question: a.question })),
      alternatives: (e.members ?? []).map((m) => ({
        slug: m.slug,
        claim: m.claim,
        source: m.primary_source?.url,
      })),
    }));
}

/**
 * Everything the corpus can support, as a draft plan.
 *
 * Deliberately produces no calendar and no briefs. Those are choices a person
 * makes; this only establishes what may truthfully be said, and what may not.
 */
export function deriveLaunchPlan(product: string): LaunchPlan {
  const entities = loadEntities(product);
  const claims = [
    ...claimsFromBenchmarks(product),
    ...claimsFromEntities(product, entities),
    ...claimsFromIncidents(product),
  ];

  return {
    product,
    positioning: "",
    audiences: audiencesFromVoices(product),
    claims,
    briefs: [],
    calendar: [],
  };
}

/** What the corpus cannot yet support — the honest other half of the derivation. */
export type Gap = { what: string; why: string; fix: string };

export function launchGaps(product: string, plan: LaunchPlan): Gap[] {
  const gaps: Gap[] = [];
  const entities = loadEntities(product);

  if (!plan.claims.some((c) => c.kind === "benchmark")) {
    gaps.push({
      what: "No measured proof point",
      why: "Nothing in benchmarks.json carries both a number and a source, so there is no claim of the form 'it is this much better' that could survive being questioned.",
      fix: `Add a measured benchmark with its source to app/(products)/${product}/research/content/benchmarks.json.`,
    });
  }
  if (plan.audiences.length === 0) {
    gaps.push({
      what: "No evidenced audience",
      why: "voices.json is empty or untagged, so every segment would be invented rather than observed.",
      fix: "Record what named practitioners said in public, with links. Three real quotes beat a persona.",
    });
  }
  if (competitiveFrames(product).length === 0) {
    gaps.push({
      what: "No competitive frame",
      why: "No MOC in the corpus names the alternatives and the axes they split on, so the buyer's actual comparison set is undocumented.",
      fix: "Write a MOC: a thesis, ≥2 axes, and ≥3 members each with a primary source.",
    });
  }
  const sellable = entities.filter((e) => {
    const g = gateFor(e);
    return (g.current.label === "working" || g.current.label === "reference") && g.overclaimed.length === 0;
  });
  if (sellable.length === 0) {
    gaps.push({
      what: "No entity is deep enough to sell from",
      why: "Every entity sits below the `working` rung, or claims a rung it has not earned. A marketing claim resting on one would inherit its thinness.",
      fix: "Run `pnpm research:audit` and take the top of the backlog to `working`.",
    });
  }
  return gaps;
}
