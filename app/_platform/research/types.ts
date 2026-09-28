/**
 * Research content model — the schema for a research entity.
 *
 * The unit of research is an **Entity** (a competitor, frontier lab, protocol,
 * technique, or internal surface). Every entity carries a **depth_score** on a
 * 0–10 ladder; the researcher's job is to move entities up the ladder with
 * citations, mechanisms, and cross-links. Entities reference each other via
 * `[[slug]]` wikilink pills in prose and via typed **edges**.
 *
 * This model is product-agnostic. Each product supplies its OWN entities +
 * edges under app/(products)/<slug>/research/content/, and the shared engine
 * (engine.ts) renders them into that product's research site.
 */

/** 0 stub · 2 skeleton · 4 foundation · 6 working · 8 reference · 10 canonical. */
export type DepthScore = number;

/**
 * `moc` is the second research tier — a map of content.
 *
 * An entity answers "what is this thing." A MOC answers "what are these things
 * arguing about," by naming the axes they differ on and taking a position. It is
 * a first-class research artefact, not an index page: it carries a thesis, and
 * each member row carries its own primary source.
 */
export type EntityKind = "public" | "private" | "internal" | "open-source" | "moc";
export type Category = "landscape" | "peer" | "frontier" | "internal";
export type Status = "shipped" | "building" | "research" | "watch";

export type Swot = {
  strengths?: string[];
  weaknesses?: string[];
  opportunities?: string[];
  threats?: string[];
};

export type Formula = { name: string; expr: string; note?: string };

/**
 * A withdrawn claim: what the reader is told, and what the gate enforces. They are not the
 * same string, and the first version of this type made them one field — which broke both.
 *
 * `claim` is READER-FACING. It renders struck through, so it must be a complete false
 * proposition that is still coherent read alone: "Madhive acquired Bombora in 2023." Write a
 * fragment and the strike-through says something you did not mean — `claim: "a Cartesia
 * multilingual TTS product"`, struck, asserts that Cartesia has no multilingual TTS product.
 * Cartesia has one; Sonic covers 42 languages. The fabrication was the product NAME. A
 * retraction that plants a new falsehood in the reader's head is not a retraction.
 *
 * `fingerprints` are MACHINE-FACING: the exact strings whose reappearance anywhere in the
 * corpus would resurrect the fabrication. They are usually SHORT and always high-salience —
 * `Vox`, `Madhive`, `$531M` — because that is how a fabrication actually propagates. Black
 * Forest Labs' phantom round was never re-quoted as a sentence; its number was ADDED INTO a
 * "$531M total", which contains no phrase from the original claim. A gate keyed on the
 * proposition cannot see that sum. A gate keyed on `$531M` can.
 *
 * `allow` names the entity slugs where a fingerprint legitimately occurs. Madhive and Vox
 * Media are real; the escape hatch is explicit and reviewable, which is the point — the
 * default is that a withdrawn string is dead everywhere.
 *
 * `replaces` is what is true instead, and it must carry a citation. A retraction that only
 * withdraws leaves a hole; one that asserts a replacement is making a NEW claim on an old
 * page, and it inherits the whole burden of proof. "Ink is STT" landed here once while five
 * fields still told buyers to source STT from Deepgram. Withdrawing is half the job.
 */
export type Retraction = {
  claim: string;          // the false proposition, whole, as the reader sees it struck through
  why: string;            // what was checked, against what source, and what that source said
  on: string;             // ISO date the retraction landed
  fingerprints?: string[];// strings that must appear nowhere else (defaults to [claim])
  allow?: string[];       // entity slugs where a fingerprint is legitimate
  replaces?: string;      // what is true instead — must cite a source
};
export type Citation = { label: string; url: string; date?: string };

/**
 * Paper anatomy — the deep-research register.
 *
 * An entity researched past the "working" rung reads like a short paper:
 * abstract → background → mechanism → results → discussion → conclusion. Each
 * section carries a **kicker** (the one-line claim the section defends) and the
 * bullets that defend it. Optional: an entity with only `summary` still renders.
 */
export type Section = { kicker?: string; bullets?: string[] };

/**
 * A mechanism part, with the prior art it chose between and the tradeoff taken.
 *
 * `ref_slug` optionally names the entity this alternative IS, when the corpus carries
 * one — the machine-readable link behind the human `name`. It renders nothing today,
 * but it is a cross-reference, so `validate-content` holds it to the same
 * must-resolve rule as a `[[pill]]`: a ref_slug that points at no entity is a dangling
 * link, and the gate fails closed on it.
 */
export type PriorArt = { name: string; approach?: string; tradeoff?: string; ref_slug?: string };

/**
 * A quantitative anchor, carrying its own receipt.
 *
 * The reason `source` sits on the number and not on the paragraph: a component
 * that says "manages memory efficiently" is worth nothing, while one that says
 * `block size = 16 tokens · eviction = LRU` with a link to the doc that says so
 * is worth reading. The depth ladder's "working" rung is gated on there being at
 * least one of these, which is what stops an entity from reaching it on prose.
 */
export type Num = { label: string; value: string; source?: string };

export type Component = {
  name: string;
  purpose?: string;
  numbers?: Num[];              // 4–7 anchors is the bar for a deep component
  prior_art?: PriorArt[];       // 3–5 named alternatives and what each trades away
  recommended?: string;         // the pick, and why
};

/** A measured result: one metric, its values over time//condition, and the receipt. */
/**
 * A measured result, metric by metric.
 *
 * `values` renders as a numeral column, so it holds numbers — a figure, its unit,
 * its range. `note` is where a number that needs qualifying gets qualified: which
 * of two figures is a closed deal and which is an ask, whose denominator this is,
 * what the reader would divide by if they trusted a different source. That work is
 * prose and does not fit in a cell; a benchmark whose caveat is crammed into its
 * value column is a table nobody can read and a caveat nobody will.
 */
export type Benchmark = {
  metric: string;
  values?: Record<string, string>;
  source?: string;
  note?: string;
};

/**
 * A member of a map-of-content, with the one-line claim the MOC makes about it.
 *
 * The annotation is the editorial work — a MOC that just lists its members is a
 * tag bucket. `primary_source` is per-member because a comparison's credibility
 * is per-row: one unsourced row taints the table.
 */
export type MocMember = {
  slug: string;                 // resolves to an entity in this product
  claim: string;                // what this MOC asserts about this member
  primary_source?: Citation;
};

/** One axis of a comparison — the named bet the members are separated on. */
export type Axis = { name: string; question: string; note?: string };

export type Entity = {
  slug: string;                 // unique within the product; the URL segment
  name: string;
  subtitle?: string;
  category: Category;
  status: Status;
  entity_kind?: EntityKind;
  depth_score: DepthScore;
  tags?: string[];
  url?: string | null;
  /**
   * Other domains this entity owns. An org and its product often live apart —
   * `anthropic-skills` is documented on platform.claude.com but blogs on anthropic.com —
   * and the depth ladder's `primary` rung accepts a citation from any of them. Without
   * this, an entity that cites its own engineering blog reads as never citing itself.
   */
  primary_domains?: string[];
  last_updated: string;         // ISO date

  /** Overview prose. Supports [[slug]] wikilink pills. */
  summary?: string;
  architecture_summary?: string;
  /** Where this sits relative to the rest of the graph. Supports pills. */
  positioning?: string;

  /** Paper anatomy. Present on entities researched to depth; all optional. */
  abstract?: Section;
  background?: Section;
  mechanism?: Section;
  results?: Section;
  discussion?: Section;
  conclusion?: Section;
  components?: Component[];     // the mechanism, part by part
  benchmarks?: Benchmark[];     // the results, metric by metric
  recommendation?: string;      // the call this research makes
  diagram_svg?: string;         // inline SVG figure (trusted, repo-authored)
  /** Public/private facts on the depth ladder's "foundation" rung (valuation, ARR, …). */
  data_points?: Record<string, string>;

  swot?: Swot;
  formulas?: Formula[];
  citations?: Citation[];
  key_takeaways?: string[];
  open_questions?: string[];

  /**
   * A retraction, declared so a machine can enforce it.
   *
   * Retractions used to live as prose in `open_questions`, and prose is where they went to
   * die. A fabrication does not live in a file — it lives in the corpus, and it survives in
   * whichever entity you were not looking at. [[bombora]] retracted the Madhive acquisition
   * and left it standing in 19 fields of the same file. [[black-forest-labs]] retracted a
   * Series B that never happened, but the phantom round's number had already been ADDED INTO
   * a "$531M total" — a sum that quotes no phrase from the claim, and that no grep for the
   * fabricated source could ever have found.
   *
   * `validate-coherence` tried to infer the withdrawn claim by reading the prose. It cannot
   * be done, and the attempt is documented in that file: a retraction quotes the false claim
   * AND the true correction, and lexically those are the same thing. The gate read
   * "Alphabet's $185B FY26 capex" — the figure a retraction was CONFIRMING — as withdrawn.
   *
   * So the author declares `fingerprints[]`: the strings that must no longer appear anywhere
   * in the corpus outside a retraction. No inference, and the gate fails the build the moment
   * one of them is asserted again, in this entity or in any other.
   */
  retractions?: Retraction[];

  /**
   * Connectivity. An entity nobody links to is an entity nobody finds; the
   * validator warns on orphans, and the `reference` rung is gated on inbound
   * links, so placement is part of the research, not an afterthought.
   */
  belongs_to?: string[];        // MOC slugs this entity is a member of (cap 2)
  related?: string[];           // sibling entity slugs

  /** MOC-only (entity_kind: "moc"): the thesis, the axes, and the members. */
  thesis?: string;              // the claim the map makes. A sentence you can disagree with.
  axes?: Axis[];
  members?: MocMember[];
  /** Found while researching, judged not worth a page yet — with the reason. */
  discovered_not_added?: { name: string; why_not: string }[];
};

/**
 * The cited substrates — evidence that belongs to the product's research corpus
 * rather than to any single entity.
 *
 * Each is a different *kind* of receipt, and keeping them apart is the point:
 *   voice     — what a named person said, in public. A quote, not a paraphrase.
 *   benchmark — a measured number, bound to the claim it backs.
 *   incident  — what actually happened, dated, with the lesson it forced.
 *
 * They live in the product's content/ dir and are discovered by filename. Every
 * one carries a source URL, so all three feed the sources index and the
 * publisher-concentration check.
 */
export type Voice = {
  id: string;
  who: string;                  // named person — anonymous quotes are not evidence
  role?: string;
  quote: string;
  perspective?: "practitioner" | "buyer" | "builder" | "regulator";
  tag?: string;
  source_url: string;
  source_date?: string;
};

export type BenchmarkRow = {
  id: string;
  metric: string;
  value: string;
  /** The internal claim this measurement backs. A number that backs nothing is trivia. */
  backs_claim?: string;
  entity_slug?: string;
  source_url: string;
  source_kind?: "official-docs" | "published-paper" | "engineering-blog" | "release-notes";
  source_date?: string;
};

export type Incident = {
  id: string;
  title: string;
  parties?: string[];
  timeline?: { date: string; event: string; source_url?: string }[];
  outcome?: string;
  /** What the field should learn — separate from what this product does about it. */
  lesson?: string;
  response?: string;
  source_url: string;
  source_date?: string;
};

/** Only these five relationship types are legal (validate-content enforces it). */
export type Rel = "uses" | "depends-on" | "peer-of" | "cited-by" | "acquired-by";
export type Edge = { from: string; to: string; rel: Rel; note?: string };

export const REL_TYPES: Rel[] = ["uses", "depends-on", "peer-of", "cited-by", "acquired-by"];

export type TopologyNode = {
  slug: string;
  name: string;
  category: Category;
  depth_score: DepthScore;
  inbound: number;
  outbound: number;
};

export type Topology = {
  product: string;
  generatedAt: string;
  nodes: TopologyNode[];
  edges: Edge[];
  depthHistogram: Record<string, number>; // score bucket → count
};

// The depth ladder — rungs, promotion gates, staleness, and the research
// backlog — lives in ./depth. It is code rather than a comment because the gates
// are predicates over an Entity: the system computes whether a score was earned
// instead of trusting the number in the file.
export { RUNGS, MOC_RUNGS, laddersFor, rungFor, depthLabel, gateFor, earnedRung, refreshDays, isStale, backlog } from "./depth";
export type { Rung, RungLabel, Requirement, Gate, BacklogItem, DepthContext } from "./depth";
