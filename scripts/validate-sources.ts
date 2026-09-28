/**
 * validate-sources — do the citations point at anything?
 *
 * A persistently dead citation is the fabrication signal that `validate-content`
 * cannot catch. That gate proves a URL is *present*; this one asks whether it was
 * ever real. An entity can satisfy every structural check and still cite a page
 * that has never existed.
 *
 * Warn-only, always exits 0, and that is deliberate:
 *
 *   - A 404 is worth investigating, but a link rotting is not a reason nobody can
 *     ship anything today.
 *   - Only 404/410 are evidence. A 403 means the host blocks bots — Bloomberg,
 *     Reuters, and most paywalls refuse a HEAD request as a matter of course, and
 *     treating that as "dead" would flag the *best* sources in the corpus.
 *
 * Results cache for a week (data/url-check-cache.json) so a build does not fire
 * thousands of requests at other people's servers.
 *
 *   npx tsx scripts/validate-sources.ts            # cached
 *   npx tsx scripts/validate-sources.ts --fresh    # ignore the cache
 */
import fs from "node:fs";
import path from "node:path";
import { loadEntities } from "../app/_platform/research/engine";
import { productsWithResearch } from "./_scan";
import { loadVoices, loadBenchmarkRows, loadIncidents } from "../app/_platform/research/substrates";

const FRESH = process.argv.includes("--fresh");
const CACHE_FILE = path.join(process.cwd(), "data", "url-check-cache.json");
const CONCURRENCY = 6;
const TIMEOUT_MS = 6000;

/**
 * A real browser's UA. Without one, Zendesk / NVIDIA / The Verge / Microsoft return 404 to us
 * and the gate reports live citations as dead. A link-checker that cannot be distinguished from
 * a bot gets bot answers, and then the corpus gets "repaired" against them.
 */
// A socket reset from any one host must not take the run down with it.
process.on("uncaughtException", (e: NodeJS.ErrnoException) => {
  if (e?.code === "UND_ERR_SOCKET" || e?.code === "ECONNRESET") return;
  throw e;
});

const UA = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const proseSources: { where: string; text: string }[] = [];

type Verdict = "ok" | "dead" | "inconclusive";
type Cached = { verdict: Verdict; status: number; week: string };

/** ISO week — the cache key's expiry. Re-checking a live URL daily is rude. */
function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

let cache: Record<string, Cached> = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
} catch {
  /* first run */
}

const thisWeek = isoWeek();

async function check(url: string): Promise<Cached> {
  const hit = cache[url];
  if (!FRESH && hit && hit.week === thisWeek) return hit;

  let status = 0;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: ctl.signal, headers: UA });
    // Some hosts refuse HEAD but answer GET. Give them the benefit of the doubt.
    if (res.status === 405 || res.status === 501 || res.status === 403 || res.status === 404) {
      // 404 is retried on GET because several hosts (Zendesk, NVIDIA, Microsoft blogs) answer a
      // bare HEAD with 404 and the same URL with 200 on a real GET. Trusting the HEAD marked
      // four live citations dead — and a "repair" of a live source destroys evidence to satisfy
      // a broken detector. The gate must not be the thing that fabricates.
      res = await fetch(url, { method: "GET", redirect: "follow", signal: ctl.signal, headers: UA });
    }
    clearTimeout(timer);
    status = res.status;
    // Drain the body. A GET leaves an open HTTP/2 stream, and when the peer resets it the
    // socket error fires asynchronously — AFTER this try/catch has returned — as an unhandled
    // 'error' event that kills the process. The run died on URL ~1 of 4,717 and exited 1 with
    // no report. A link-checker that cannot survive a rude server is a link-checker that does
    // not run, which is the exact failure this whole file exists to correct.
    await res.body?.cancel().catch(() => {});
  } catch {
    // Network error, timeout, DNS failure. Not evidence the page is gone.
    const out: Cached = { verdict: "inconclusive", status: 0, week: thisWeek };
    cache[url] = out;
    return out;
  }

  const verdict: Verdict = status === 404 || status === 410 ? "dead" : status < 400 ? "ok" : "inconclusive";
  const out: Cached = { verdict, status, week: thisWeek };
  cache[url] = out;
  return out;
}

/** Every cited URL, and who cites it. */
const cited = new Map<string, { product: string; slug: string }[]>();
for (const product of productsWithResearch()) {
  for (const e of loadEntities(product)) {
    // Every URL the entity leans on, wherever it hides. Walking the object rather than
    // listing the fields, because the fields that were listed are the fields somebody
    // remembered, and a source that renders to a reader from a key nobody listed is the
    // one that will be fabricated. The gate found 335 dead links the first time it ran;
    // one of them was a Ramp index page backing a "#1 in AI-native GTM spend" claim that
    // no citation carried, and it had been on the page for the life of the corpus.
    const urls: (string | undefined)[] = [];
    const walk = (v: unknown, key: string | undefined, depth: number) => {
      if (typeof v === "string") {
        // The entity's own `url` is its homepage, not a citation. Sweeping it in would pad
        // the dead-link report with vendor front pages — and the failure this gate exists to
        // prevent is somebody reading the count instead of the list. A list you cannot trust
        // is a list nobody reads.
        //
        // Depth 1, not 0: `walk` is entered ON the entity object, so the entity's own keys are
        // its children and are visited one level down. The first version of this guard tested
        // depth 0, never fired, and let all 109 homepages through — which is the same shape as
        // every other bug in this file's history: a check that looks right and tests nothing.
        if (depth === 1 && key === "url") return;
        if (key === "url" || key === "source" || key === "source_url") {
          // A `source` is frequently prose, not a link — "Vendor docs + internal review",
          // "community benchmarks + vendor docs, May 2026". Feeding those to fetch() 404s
          // them and reports them as dead citations. 58 of the corpus's "dead links" were
          // this: the gate measuring its own confusion. Collect real URLs; count the rest
          // separately, because a number whose source is a sentence is a different problem
          // and a worse one.
          if (/^https?:\/\/\S+$/.test(v.trim())) urls.push(v.trim());
          else if (v.trim()) proseSources.push({ where: `${product}/${e.slug}`, text: v.trim() });
        }
      } else if (Array.isArray(v)) v.forEach((x) => walk(x, key, depth));
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k, depth + 1);
    };
    walk(e, undefined, 0);
    for (const url of urls) {
      if (!url || !/^https?:\/\//.test(url)) continue;
      const who = cited.get(url) ?? [];
      who.push({ product, slug: e.slug });
      cited.set(url, who);
    }
  }
}

/**
 * Wrapped in a main(), not left at module scope.
 *
 * Top-level await transpiles to CJS here and the script died on a TransformError before it
 * checked a single URL — so the one gate that can catch a fabricated citation was reporting
 * nothing because it was never running. A gate that fails loudly is a gate; a gate that fails
 * at import time is a comment.
 */
async function main() {
  // The substrates render in the sources index and carry their own `source_url`s — a quote
// with a link is exactly the shape a fabricated citation takes, and until now no gate had
// ever fetched one of them. They live in their own files, so walking the entity object was
// never going to reach them: the first version of this fix collected 4,146 URLs, the same
// number as the hand-list it replaced, which is how I know it reached nothing new.
for (const product of productsWithResearch()) {
  const rows: { source_url?: string; who?: string; metric?: string; title?: string }[] = [
    ...loadVoices(product),
    ...loadBenchmarkRows(product),
    ...loadIncidents(product),
  ];
  for (const r of rows) {
    const url = r.source_url;
    if (!url || !/^https?:\/\//.test(url)) continue;
    const who = cited.get(url) ?? [];
    who.push({ product, slug: `substrate: ${r.who ?? r.metric ?? r.title ?? "row"}` });
    cited.set(url, who);
  }
}

const urls = [...cited.keys()];
  console.log(`  checking ${urls.length} cited URLs (cache: ${thisWeek}${FRESH ? ", bypassed" : ""})`);

  const results = new Map<string, Cached>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
      while (cursor < urls.length) {
        const url = urls[cursor++];
        results.set(url, await check(url));
      }
    }),
  );

  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");

  const dead = urls.filter((u) => results.get(u)?.verdict === "dead");
  const inconclusive = urls.filter((u) => results.get(u)?.verdict === "inconclusive").length;
  const ok = urls.length - dead.length - inconclusive;

  if (proseSources.length)
    console.warn(
      `\n! validate-sources: ${proseSources.length} source field(s) are prose, not a URL` +
        ` — a claim whose source is a sentence cannot be checked by anyone\n` +
        proseSources.slice(0, 8).map((x) => `  - [${x.where}] ${x.text.slice(0, 72)}`).join("\n"),
    );

  console.log(`  ${ok} reachable · ${inconclusive} inconclusive (bot-blocked, paywalled, or timed out) · ${dead.length} dead`);

  if (dead.length === 0) {
    console.log("✓ validate-sources: no dead citations");
    process.exit(0);
  }

  // --json prints the WHOLE list. The console report caps at 20, which is right for a
  // build log and wrong for the work queue: a backlog you can only see 20 of is a backlog
  // you will always believe is 20 long.
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(dead.map((url) => ({
      url, status: results.get(url)!.status,
      cited_by: cited.get(url)!.map((w) => `${w.product}/${w.slug}`),
    })), null, 2));
    process.exit(0);
  }

  console.warn(`\n! validate-sources: ${dead.length} citation(s) return 404/410\n`);
  for (const url of dead.slice(0, 20)) {
    const who = cited.get(url)!;
    const where = who.slice(0, 2).map((w) => `${w.product}/${w.slug}`).join(", ");
    console.warn(`  ${results.get(url)!.status}  ${url}`);
    console.warn(`       cited by ${where}${who.length > 2 ? ` +${who.length - 2} more` : ""}`);
  }
  if (dead.length > 20) console.warn(`  … and ${dead.length - 20} more`);
  console.warn("\n  A citation that never resolves is the fabrication signal the structural gates miss.");
  console.warn("  Verify against the primary source and replace it, or drop the claim it backs.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
