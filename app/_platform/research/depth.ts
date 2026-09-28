/**
 * The depth ladder — what a `depth_score` actually means, as code.
 *
 * A score on its own is a number an agent can type. What makes the ladder real
 * is that each rung names the evidence it requires, and the requirement is a
 * predicate over the entity — so the system can compute, rather than be told,
 * whether an entity has earned its score and exactly what the next rung is
 * still missing.
 *
 * Two things read this:
 *   - the researcher (via the `depth-ladder` skill), to pick the next move;
 *   - EntityPage, to render the rung and its open gate to the reader.
 *
 * The rule the ladder exists to serve: **no entity is done.** A run's job is to
 * take at least one entity up one rung.
 */
import type { Entity } from "./types";

export type RungLabel = "stub" | "skeleton" | "foundation" | "working" | "reference";

/**
 * What the corpus knows about this entity that the entity file cannot.
 *
 * Link counts and the depth of a MOC's members live in the graph, not in the
 * JSON, so the caller supplies them. Requirements that depend on this context
 * default to *unmet* when it is absent — an unproven gate is not a passed one.
 */
export type DepthContext = {
  inbound?: number;
  outbound?: number;
  /** MOC only: how many members sit below the `working` rung. */
  membersBelowWorking?: number;
};

export type Requirement = {
  id: string;
  /** Written as the thing you must produce, so an unmet list reads as a to-do. */
  label: string;
  met: (e: Entity, ctx: DepthContext) => boolean;
};

export type Rung = {
  label: RungLabel;
  /** Lowest score that claims this rung. */
  min: number;
  /** One line: what an entity at this rung *is*. */
  note: string;
  /** Everything true at this rung. Cumulative — a rung inherits the ones below it. */
  requires: Requirement[];
};

const dated = (c: { date?: string }) => Boolean(c.date);
const citations = (e: Entity) => e.citations ?? [];
const withinDays = (iso: string | undefined, days: number, now: number): boolean => {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return now - t <= days * 86_400_000;
};

/** Any component number carrying its own source — the "grounded numerical claim" gate. */
function sourcedNumbers(e: Entity): number {
  let n = 0;
  for (const c of e.components ?? []) {
    for (const num of c.numbers ?? []) if (num.source) n += 1;
  }
  for (const b of e.benchmarks ?? []) if (b.source) n += 1;
  return n;
}

/**
 * Does the entity cite a primary source it owns — its docs, its filing, its blog?
 *
 * The `primary` rung is named for this and long did not test it: the predicate asked only
 * that some citation have a URL and a date. The gap was not academic. A pass that parsed
 * dates out of citation labels, adding no evidence and only reformatting what was already
 * filed, moved 26 entities from skeleton straight to reference — a dated URL was all the
 * rung had ever asked for. Seven then rendered as "the page a serious reader would cite"
 * without quoting the subject once.
 *
 * The first repair of that bug reintroduced it one layer up. It compared citations against
 * the domain of `e.url` alone while the label still promised "docs, filing, or blog", and
 * those are not the same test: `anthropic-skills` lives on platform.claude.com and cites a
 * dated Anthropic engineering post about Agent Skills — unambiguously its blog, and
 * rejected. A label that promises three things while the code accepts one is the same
 * defect the rung exists to catch, so the code now accepts all three and the label says
 * exactly what the code does.
 *
 * Matching is on the registrable domain, so a subdomain counts: `copilot-review` lives at
 * github.com/features/copilot and cites docs.github.com, which is its documentation and
 * should pass. Two-part suffixes are handled explicitly, because slicing the last two
 * labels turns gic.com.sg into com.sg and would give every Singaporean company the same
 * home.
 *
 * Seventeen entities live on a platform somebody else owns: github.com (10), arxiv.org (3),
 * huggingface.co (2), notion.so (2). Matching those on the domain alone hands all seventeen
 * the same home, so an entity at github.com/foo would satisfy this rung by citing somebody
 * else's repository. Being hosted next to a primary source is not the same as having one.
 *
 * So `HOSTED_ON` splits the two cases. If your `url` is on a platform you do not own, the
 * thing you own is your artifact and not the platform, and a citation counts only if it
 * points at an artifact you own. If you DO own the platform, and GitHub the company does
 * own github.com, declare it in `primary_domains` and the domain rule applies again. That
 * is why `copilot-review` (github.com/features/copilot, citing docs.github.com) declares
 * github.com and passes.
 *
 * `primary_domains` therefore takes artifacts as well as domains, and the reason is a
 * mistake worth recording. An earlier revision of this rule demoted `sales-research-bench`
 * and cited it here as proof the loophole was being exercised: its url is
 * arxiv.org/abs/2602.17017 and it cites arxiv.org/abs/2510.00915, which the rule read as
 * somebody else's paper. It is not. Both are Bhol et al. on this very benchmark, an
 * October 2025 paper and a February 2026 formal writeup, and the one it cites is
 * unambiguously its own primary source. A rule strict enough to catch a squatter was also
 * strict enough to reject an author's own earlier paper, and the worked example that
 * justified the mechanism was simply false. The entity now declares both artifacts.
 *
 * What the rule did find is a real defect of a different kind: the entity's `url` points at
 * a paper it never cites, and its architecture_summary dated that paper "submitted
 * 2025-12-01" when a 2602 arXiv ID encodes February 2026. Worth keeping in mind about
 * gates in general. This one paid for itself by surfacing bad data, not by catching the
 * cheat it was built for, and no entity in the corpus is currently exploiting the hole.
 *
 * An entity with no `url` is a concept, and a concept has no docs of its own to cite;
 * demanding them is the category error of asking a MOC for a SWOT. For those the rung
 * falls back to what can be checked — that some citation is dated — and the label says so,
 * so a pass is never read as more than it is.
 */
const TWO_PART_SUFFIXES = new Set([
  "com.sg", "co.uk", "com.au", "co.jp", "com.br", "co.in", "com.cn", "co.kr", "com.hk", "co.za",
]);

/** Platforms that host other people's work. Living here does not make the domain yours. */
const HOSTED_ON = new Set([
  "arxiv.org", "github.com", "gitlab.com", "huggingface.co", "npmjs.com", "pypi.org",
  "notion.so", "notion.site", "medium.com", "substack.com",
]);

/** The artifact itself, normalised: no trailing slash, no arXiv version suffix, lowercased. */
function artifactOf(u: string | null | undefined): string {
  try {
    const url = new URL(u!);
    const path = url.pathname.replace(/\/+$/, "").replace(/v\d+$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path}`.toLowerCase();
  } catch {
    return "";
  }
}

function homeOf(u: string | null | undefined): string {
  let host: string;
  try {
    host = new URL(u!).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
  const parts = host.split(".");
  const last2 = parts.slice(-2).join(".");
  return TWO_PART_SUFFIXES.has(last2) ? parts.slice(-3).join(".") : last2;
}

export function citesOwnSource(e: Entity): boolean {
  const cites = citations(e);
  const declared = (e.primary_domains ?? []).map((d) => (d.includes("//") ? d : `https://${d}`));
  const homes = new Set([e.url, ...declared].map(homeOf).filter(Boolean));
  if (!homes.size) return cites.some(dated); // a concept has no domain to cite

  // Hosted on a platform you do not own, and you have not claimed the platform itself:
  // your source is your artifact. Citing the neighbours does not count. Anything listed
  // in `primary_domains` with a path is an artifact you also own — an author's earlier
  // paper, a second repository — and counts alongside your `url`.
  const own = homeOf(e.url);
  const claimsPlatform = declared.some((d) => !new URL(d).pathname.replace(/\/+$/, "") && homeOf(d) === own);
  if (HOSTED_ON.has(own) && !claimsPlatform) {
    const mine = [e.url, ...declared].map(artifactOf).filter(Boolean);
    return cites.some((c) => dated(c) && mine.some((m) => artifactOf(c.url).startsWith(m)));
  }
  return cites.some((c) => dated(c) && homes.has(homeOf(c.url)));
}

function swotFilled(e: Entity): boolean {
  const s = e.swot;
  if (!s) return false;
  const quadrants = [s.strengths, s.weaknesses, s.opportunities, s.threats];
  return quadrants.filter((q) => (q?.length ?? 0) > 0).length >= 2;
}

/**
 * The rungs, low to high. Requirements are cumulative: `gateFor` checks every
 * requirement at or below the target rung, so an entity cannot skip evidence by
 * jumping its score.
 *
 * **Rungs are structural, never temporal.** No requirement here asks how old
 * anything is. Age is the other axis — `refreshDays` / `isStale` — and the two
 * are kept apart on purpose:
 *
 *   overclaimed → the evidence was never there.   (dishonesty; fix or demote)
 *   stale       → the evidence aged.              (maintenance; go refresh it)
 *
 * Fold recency into a promotion gate and every well-researched page from six
 * months ago starts reporting as overclaimed. The signal then fires on
 * everything, which is the same as firing on nothing.
 */
export const RUNGS: Rung[] = [
  {
    label: "stub",
    min: 0,
    note: "A name and a line saying what it is.",
    requires: [
      { id: "summary", label: "a one-line summary", met: (e) => Boolean(e.summary?.trim()) },
    ],
  },
  {
    label: "skeleton",
    min: 3,
    note: "Enough shape to argue with: a position, and one real source.",
    requires: [
      { id: "kind", label: "entity_kind set", met: (e) => Boolean(e.entity_kind) },
      { id: "swot", label: "SWOT filled on ≥2 quadrants", met: swotFilled },
      { id: "cite-1", label: "≥1 citation", met: (e) => citations(e).length >= 1 },
    ],
  },
  {
    label: "foundation",
    min: 5,
    note: "The facts are in and it knows where it sits in the graph.",
    requires: [
      {
        id: "primary",
        label:
          "≥1 dated citation from a source the entity owns: its url's domain, or any domain it " +
          "declares in primary_domains (docs, filing and blog all count). An entity hosted on a " +
          "platform it does not own (arXiv, GitHub) must cite its own artifact there, not merely " +
          "the same domain. A concept that owns no domain needs only ≥1 dated citation.",
        met: citesOwnSource,
      },
      { id: "takeaways", label: "key_takeaways written", met: (e) => (e.key_takeaways?.length ?? 0) >= 1 },
      {
        /**
         * Placement. An entity that names no neighbours is a page nobody reaches
         * and nobody can situate. Any of the three ways x expresses placement
         * counts — a `positioning` paragraph, the facts in `data_points`, or an
         * actual edge in the graph. Demanding one specific field would fail
         * entities that are well placed by another.
         */
        id: "placement",
        label: "placement — positioning prose, data_points, or an edge to a neighbour",
        met: (e, ctx) =>
          Boolean(e.positioning?.trim()) ||
          Object.keys(e.data_points ?? {}).length > 0 ||
          (e.related?.length ?? 0) > 0 ||
          (ctx.inbound ?? 0) + (ctx.outbound ?? 0) > 0,
      },
    ],
  },
  {
    label: "working",
    min: 7,
    note: "It explains a mechanism and every number has a receipt.",
    requires: [
      {
        id: "mechanism",
        label: "a mechanism — how it actually works, part by part",
        met: (e) =>
          Boolean(e.architecture_summary?.trim() || e.mechanism?.bullets?.length || e.components?.length),
      },
      {
        id: "number",
        label: "≥1 numerical claim grounded in a dated primary source",
        met: (e) => sourcedNumbers(e) >= 1,
      },
      { id: "cite-6", label: "≥6 citations", met: (e) => citations(e).length >= 6 },
      { id: "open-q", label: "open questions named", met: (e) => (e.open_questions?.length ?? 0) >= 1 },
    ],
  },
  {
    label: "reference",
    min: 9,
    note: "The page a serious reader would cite. Diagrammed, densely sourced, linked to.",
    requires: [
      { id: "diagram", label: "a diagram", met: (e) => Boolean(e.diagram_svg?.trim()) },
      { id: "cite-12", label: "≥12 citations", met: (e) => citations(e).length >= 12 },
      {
        id: "inbound-3",
        label: "linked from ≥3 other pages",
        met: (_e, ctx) => (ctx.inbound ?? 0) >= 3,
      },
    ],
  },
];

/**
 * A map of content climbs a different ladder.
 *
 * Asking a MOC for a SWOT is a category error: it is not a thing, it is an
 * argument about several things. Its evidence is a thesis you can disagree with,
 * the axes it separates its members on, and a primary source under every row —
 * a comparison's credibility is per-row, so one unsourced member taints the table.
 */
export const MOC_RUNGS: Rung[] = [
  {
    label: "stub",
    min: 0,
    note: "A named cluster, with nothing said about it yet.",
    requires: [{ id: "summary", label: "a one-line summary", met: (e) => Boolean(e.summary?.trim()) }],
  },
  {
    label: "skeleton",
    min: 3,
    note: "It makes a claim and names who it is about.",
    requires: [
      {
        id: "thesis",
        label: "a thesis — a claim about these members you could disagree with",
        met: (e) => Boolean(e.thesis?.trim()),
      },
      { id: "members-3", label: "≥3 members (fewer is not a map)", met: (e) => (e.members?.length ?? 0) >= 3 },
    ],
  },
  {
    label: "foundation",
    min: 5,
    note: "It says something specific about each member, and names what separates them.",
    requires: [
      {
        id: "claims",
        label: "every member annotated with a claim (a list is not a map)",
        met: (e) => (e.members ?? []).every((m) => Boolean(m.claim?.trim())),
      },
      { id: "axes-2", label: "≥2 named axes", met: (e) => (e.axes?.length ?? 0) >= 2 },
    ],
  },
  {
    label: "working",
    min: 7,
    note: "Every row carries its own receipt, and the map admits what it left out.",
    requires: [
      {
        id: "member-sources",
        label: "a primary source on every member (one unsourced row taints the table)",
        met: (e) => (e.members ?? []).every((m) => Boolean(m.primary_source?.url)),
      },
      { id: "axes-4", label: "≥4 named axes", met: (e) => (e.axes?.length ?? 0) >= 4 },
      { id: "open-q", label: "open questions named", met: (e) => (e.open_questions?.length ?? 0) >= 1 },
      {
        id: "not-added",
        label: "what you looked at and chose not to add, with the reason",
        met: (e) => (e.discovered_not_added?.length ?? 0) >= 1,
      },
    ],
  },
  {
    label: "reference",
    min: 9,
    note: "The map a reader would cite to settle the argument.",
    requires: [
      {
        id: "member-depth",
        label: "every member's own page at working depth or above",
        // Checked by the caller, which has the corpus; without it we cannot know.
        met: (_e, ctx) => (ctx.membersBelowWorking ?? 1) === 0,
      },
      { id: "dated", label: "every member's source dated", met: (e) => (e.members ?? []).every((m) => Boolean(m.primary_source?.date)) },
      { id: "inbound-3", label: "linked from ≥3 other pages", met: (_e, ctx) => (ctx.inbound ?? 0) >= 3 },
    ],
  },
];

/** Entities and maps are graded on different evidence. */
export function laddersFor(e: Entity): Rung[] {
  return e.entity_kind === "moc" ? MOC_RUNGS : RUNGS;
}

export function rungFor(score: number, ladder: Rung[] = RUNGS): Rung {
  let rung = ladder[0];
  for (const r of ladder) if (score >= r.min) rung = r;
  return rung;
}

export function depthLabel(score: number): RungLabel {
  return rungFor(score).label;
}

/** Every requirement at or below a rung — the ladder is cumulative. */
function requirementsThrough(rung: Rung, ladder: Rung[]): Requirement[] {
  const out: Requirement[] = [];
  for (const r of ladder) {
    out.push(...r.requires);
    if (r.label === rung.label) break;
  }
  return out;
}

export type Gate = {
  current: Rung;
  /** null once the entity is at `reference` — the top rung is a standard, not a finish line. */
  next: Rung | null;
  /** What the NEXT rung still needs. Empty means the entity has earned a promotion. */
  unmet: Requirement[];
  /** Requirements the entity's CURRENT score claims but has not earned. */
  overclaimed: Requirement[];
};

/**
 * What this entity needs to go up one rung — and whether it has earned the rung
 * it already claims.
 *
 * `overclaimed` is the honest half: an agent can write `depth_score: 9` into a
 * JSON file, but it cannot fake a diagram or twelve citations. Anything listed
 * there is a score the content does not support.
 */
export function gateFor(e: Entity, ctx: DepthContext = {}): Gate {
  const ladder = laddersFor(e);
  const current = rungFor(e.depth_score, ladder);
  const idx = ladder.findIndex((r) => r.label === current.label);
  const next = idx >= 0 && idx < ladder.length - 1 ? ladder[idx + 1] : null;

  const overclaimed = requirementsThrough(current, ladder).filter((r) => !r.met(e, ctx));
  const unmet = next ? requirementsThrough(next, ladder).filter((r) => !r.met(e, ctx)) : [];

  return { current, next, unmet, overclaimed };
}

/**
 * The highest rung whose evidence is actually on the page.
 *
 * This is the score the entity has *earned*, as opposed to the one written in its
 * file. Where they disagree, the file is wrong: a JSON field is an assertion, and
 * this is the check.
 */
export function earnedRung(e: Entity, ctx: DepthContext = {}): Rung {
  const ladder = laddersFor(e);
  let earned = ladder[0];
  for (const rung of ladder) {
    const ok = requirementsThrough(rung, ladder).every((r) => r.met(e, ctx));
    if (!ok) break;
    earned = rung;
  }
  return earned;
}

/**
 * How often an entity at this rung must be revisited.
 *
 * The cadence is the other half of the ladder: a reference-grade page that went
 * six months without a look is no longer reference-grade, and the score should
 * stop claiming it is.
 */
export function refreshDays(score: number): number {
  if (score >= 7) return 30;
  if (score >= 5) return 60;
  return 90;
}

export function isStale(e: Entity, now: number = Date.now()): boolean {
  return !withinDays(e.last_updated, refreshDays(e.depth_score), now);
}

/**
 * The research backlog, ordered.
 *
 * This is what makes "keep the research fresh" a queue instead of a feeling.
 * Overclaimed entities come first — a page asserting a depth it has not earned
 * is worse than a page that is honestly thin.
 */
export type BacklogItem = {
  slug: string;
  name: string;
  score: number;
  reason: "overclaimed" | "stale" | "promotable" | "thin";
  detail: string;
};

export function backlog(entities: Entity[], inbound: Record<string, number> = {}): BacklogItem[] {
  const items: BacklogItem[] = [];
  for (const e of entities) {
    const gate = gateFor(e, { inbound: inbound[e.slug] ?? 0 });
    if (gate.overclaimed.length > 0) {
      items.push({
        slug: e.slug,
        name: e.name,
        score: e.depth_score,
        reason: "overclaimed",
        detail: `claims ${gate.current.label} but is missing ${gate.overclaimed.map((r) => r.label).join(", ")}`,
      });
    } else if (isStale(e)) {
      items.push({
        slug: e.slug,
        name: e.name,
        score: e.depth_score,
        reason: "stale",
        detail: `${gate.current.label} pages refresh every ${refreshDays(e.depth_score)} days; last touched ${e.last_updated}`,
      });
    } else if (gate.next && gate.unmet.length === 0) {
      items.push({
        slug: e.slug,
        name: e.name,
        score: e.depth_score,
        reason: "promotable",
        detail: `has earned ${gate.next.label} — raise the score`,
      });
    } else if (gate.next && gate.unmet.length <= 2) {
      items.push({
        slug: e.slug,
        name: e.name,
        score: e.depth_score,
        reason: "thin",
        detail: `${gate.unmet.length} from ${gate.next.label}: ${gate.unmet.map((r) => r.label).join(", ")}`,
      });
    }
  }
  const rank: Record<BacklogItem["reason"], number> = {
    overclaimed: 0,
    stale: 1,
    promotable: 2,
    thin: 3,
  };
  return items.sort((a, b) => rank[a.reason] - rank[b.reason] || b.score - a.score);
}
