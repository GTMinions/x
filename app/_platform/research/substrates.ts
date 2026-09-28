/**
 * The cited substrates — voices, benchmarks, incidents — and the citation ledger
 * built from them.
 *
 * An entity is a claim about a thing. A substrate is a receipt that outlives any
 * one entity: what a named person said, what somebody measured, what actually
 * happened. Each lives in the product's own content dir, so a product owns its
 * evidence the same way it owns its entities:
 *
 *   app/(products)/<slug>/research/content/voices.json      Voice[]
 *   app/(products)/<slug>/research/content/benchmarks.json  BenchmarkRow[]
 *   app/(products)/<slug>/research/content/incidents.json   Incident[]
 *
 * All three are optional. A product with none of them renders fine — the loaders
 * return [] and the panels render nothing.
 *
 * `collectCitations` then walks every URL the corpus leans on (entity citations,
 * the sources bound to component numbers and entity benchmarks, plus all three
 * substrates) and normalises them into one ledger. `publisherConcentration` is
 * the honesty instrument on top of it: a corpus that rests mostly on one vendor's
 * blog is not independent research, and the ledger is what makes that visible
 * instead of arguable.
 */
import fs from "node:fs";
import path from "node:path";
import { contentDir, loadEntities } from "./engine";
import type { Voice, BenchmarkRow, Incident } from "./types";

/**
 * Same cache posture as engine.ts: content is read-only at runtime, so one parse
 * per process in production; dev re-reads so editing a JSON shows up on reload.
 */
const CACHE = process.env.NODE_ENV === "production";
const _cache = new Map<string, unknown[]>();

/** Read a top-level JSON array from the product's content dir. Missing file → []. */
function loadArray<T>(productSlug: string, file: string, ok: (v: T) => boolean): T[] {
  const key = `${productSlug}/${file}`;
  const cached = _cache.get(key) as T[] | undefined;
  if (CACHE && cached) return cached;

  let rows: T[] = [];
  try {
    const raw = fs.readFileSync(path.join(contentDir(productSlug), file), "utf8");
    const parsed = JSON.parse(raw);
    rows = Array.isArray(parsed) ? (parsed as T[]).filter(ok) : [];
  } catch (err: unknown) {
    // A missing substrate is the normal case, not a failure. A malformed one is a
    // failure, and stays loud.
    if ((err as NodeJS.ErrnoException)?.code !== "ENOENT")
      console.error(`[research.substrates] bad ${key}:`, err);
    rows = [];
  }
  if (CACHE) _cache.set(key, rows);
  return rows;
}

/** A quote nobody will stand behind is not evidence — an unnamed row is dropped. */
export function loadVoices(productSlug: string): Voice[] {
  return loadArray<Voice>(productSlug, "voices.json", (v) => !!v?.who && !!v?.quote && !!v?.source_url);
}

export function loadBenchmarkRows(productSlug: string): BenchmarkRow[] {
  return loadArray<BenchmarkRow>(
    productSlug,
    "benchmarks.json",
    (b) => !!b?.metric && !!b?.value && !!b?.source_url,
  );
}

export function loadIncidents(productSlug: string): Incident[] {
  return loadArray<Incident>(productSlug, "incidents.json", (i) => !!i?.title && !!i?.source_url);
}

export function hasSubstrates(productSlug: string): boolean {
  return (
    loadVoices(productSlug).length > 0 ||
    loadBenchmarkRows(productSlug).length > 0 ||
    loadIncidents(productSlug).length > 0
  );
}

// ── the citation ledger ────────────────────────────────────────────────────

export type CitationKind = "entity" | "voice" | "benchmark" | "incident";

export type CollectedCitation = {
  url: string;
  /** Hostname, www stripped — the unit the concentration check counts. */
  publisher: string;
  /** How the corpus cites it: the citation label, the metric, the speaker. */
  cited_as: string;
  kind: CitationKind;
  date?: string;
  /** Where on this site the citation is used — the way back from source to claim. */
  internal_href: string;
};

const URL_RE = /https?:\/\/[^\s,;)"'\]]+/g;

/** Sources on numbers and benchmarks are free prose ("Kwon et al, arXiv 2309.06180 —
 *  https://…"), sometimes carrying more than one link. Pull the URLs out; ignore
 *  the rest, because a source string with no URL is not a citation we can audit. */
function urlsIn(source: string | undefined): string[] {
  if (!source) return [];
  return (source.match(URL_RE) ?? []).map((u) => u.replace(/[.)]+$/, ""));
}

/**
 * Hosts that are not publishers — they are redirects that stand in front of one.
 *
 * A DOI link resolves to whoever actually published the paper: Springer, ACM,
 * Elsevier, a university press. Counting `doi.org` as a publisher would report
 * "45% of this corpus comes from one source" when the truth is the opposite —
 * those citations are spread across many publishers and we simply cannot see
 * which. Treating a resolver as a publisher inverts the very signal the
 * concentration check exists to give.
 */
const RESOLVER_HOSTS = new Set(["doi.org", "dx.doi.org", "hdl.handle.net", "t.co", "bit.ly", "lnkd.in"]);

export function isResolver(url: string): boolean {
  try {
    return RESOLVER_HOSTS.has(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

export function publisherOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

/**
 * Every URL the product's research corpus rests on, in one list.
 *
 * Deduped on (kind, url, internal_href, cited_as): one entity listing the same
 * paper twice counts once, two entities citing it counts twice — because two pages
 * leaning on one source is exactly the dependency the concentration check exists to
 * catch. Two people quoted from one press release are likewise two citations of it.
 */
export function collectCitations(productSlug: string): CollectedCitation[] {
  const out: CollectedCitation[] = [];
  const seen = new Set<string>();

  const push = (c: CollectedCitation) => {
    const key = `${c.kind}|${c.url}|${c.internal_href}|${c.cited_as}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  const sourcesHref = `/${productSlug}/research/sources`;
  const entityHref = (slug: string) => `/${productSlug}/research/${slug}`;

  for (const e of loadEntities(productSlug)) {
    const href = entityHref(e.slug);
    for (const c of e.citations ?? []) {
      if (!c?.url) continue;
      push({
        url: c.url,
        publisher: publisherOf(c.url),
        cited_as: c.label || e.name,
        kind: "entity",
        date: c.date,
        internal_href: href,
      });
    }
    for (const comp of e.components ?? []) {
      for (const n of comp.numbers ?? []) {
        for (const url of urlsIn(n.source)) {
          push({
            url,
            publisher: publisherOf(url),
            cited_as: `${e.name} · ${comp.name} · ${n.label}`,
            kind: "entity",
            internal_href: href,
          });
        }
      }
    }
    for (const b of e.benchmarks ?? []) {
      for (const url of urlsIn(b.source)) {
        push({
          url,
          publisher: publisherOf(url),
          cited_as: `${e.name} · ${b.metric}`,
          kind: "benchmark",
          internal_href: href,
        });
      }
    }
  }

  for (const v of loadVoices(productSlug)) {
    push({
      url: v.source_url,
      publisher: publisherOf(v.source_url),
      cited_as: `${v.who}${v.role ? `, ${v.role}` : ""}`,
      kind: "voice",
      date: v.source_date,
      internal_href: sourcesHref,
    });
  }

  for (const b of loadBenchmarkRows(productSlug)) {
    push({
      url: b.source_url,
      publisher: publisherOf(b.source_url),
      cited_as: `${b.metric} = ${b.value}`,
      kind: "benchmark",
      date: b.source_date,
      internal_href: b.entity_slug ? entityHref(b.entity_slug) : sourcesHref,
    });
  }

  for (const i of loadIncidents(productSlug)) {
    push({
      url: i.source_url,
      publisher: publisherOf(i.source_url),
      cited_as: i.title,
      kind: "incident",
      date: i.source_date,
      internal_href: sourcesHref,
    });
    for (const t of i.timeline ?? []) {
      if (!t?.source_url) continue;
      push({
        url: t.source_url,
        publisher: publisherOf(t.source_url),
        cited_as: `${i.title} · ${t.event}`,
        kind: "incident",
        date: t.date,
        internal_href: sourcesHref,
      });
    }
  }

  return out;
}

export type PublisherShare = { publisher: string; count: number; share: number };

/** Publishers by citation count, share of the whole corpus, biggest first. */
/**
 * Concentration is computed over citations whose publisher is actually known.
 *
 * Resolver-fronted links are excluded and counted separately: they are not one
 * publisher, they are an unknown number of publishers behind one hostname. Their
 * share is its own finding — "we cannot see who published this fraction of the
 * corpus" — and `opaque` carries it so the UI can say that instead of naming the
 * resolver as a dominant source.
 */
export function publisherConcentration(citations: CollectedCitation[]): PublisherShare[] {
  const known = citations.filter((c) => !isResolver(c.url));
  const counts = new Map<string, number>();
  for (const c of known) counts.set(c.publisher, (counts.get(c.publisher) ?? 0) + 1);
  const total = known.length || 1;
  return [...counts.entries()]
    .map(([publisher, count]) => ({ publisher, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.publisher.localeCompare(b.publisher));
}

/** The share of the corpus whose real publisher is hidden behind a resolver. */
export function opaqueShare(citations: CollectedCitation[]): { count: number; share: number } {
  const n = citations.filter((c) => isResolver(c.url)).length;
  return { count: n, share: citations.length ? n / citations.length : 0 };
}

/**
 * The line past which a corpus is leaning on one publisher rather than reading the
 * field. Set at 30% because a single source above that is doing more work than the
 * other publishers combined in practice; crossing it earns a review, not a block.
 */
export const CONCENTRATION_LIMIT = 0.3;

export function countByKind(citations: CollectedCitation[]): Record<CitationKind, number> {
  const by: Record<CitationKind, number> = { entity: 0, voice: 0, benchmark: 0, incident: 0 };
  for (const c of citations) by[c.kind] += 1;
  return by;
}
