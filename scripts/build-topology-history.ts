/**
 * build-topology-history — the time dimension of every product's research corpus.
 *
 * Emits public/topology-history.json: for each product, when each entity first
 * appeared, when it was last written to, and the commit-by-commit event stream
 * behind it. `build-topology` reads this to stamp first_seen / last_changed onto
 * each node; the Evolvement view reads it to scrub the corpus back through time.
 *
 * ── Two design decisions worth defending ─────────────────────────────────────
 *
 * 1. ONE git process, not 455.
 *    The obvious shape is `git log --follow` per entity file. With 455 entities
 *    that is 455 process spawns and 455 history walks, and it gets worse every
 *    time the researcher adds a page. Instead we do a single `git log --numstat`
 *    over the content directories and bucket the numstat rows by path. Rename
 *    detection (-M) replaces --follow: renames are aliased backwards as the walk
 *    goes newest → oldest, so an entity that moved keeps its history. Cold run is
 *    well under a second on this repo, so there is no cache to invalidate and no
 *    staleness bug to write.
 *
 * 2. THE FLOOR COMES FROM THE PRODUCT DATABASE, NOT FROM GIT.
 *    A product's corpus lives in its database and is pulled to disk before a
 *    build, so git has never seen the files and cannot date them. The database
 *    can: `entities.first_seen` is set on insert and `updated_at` moves only
 *    when the body does, and `product:db pull` writes both to
 *    research/content/_timestamps.json beside the entities. That file is the
 *    floor here. For an entity git has no history for, the floor IS the record.
 *    For one it does (a product whose corpus is committed), the two merge —
 *    first_seen = min, last_changed = max — so a shallow clone, whose oldest
 *    visible commit is not the oldest commit, can only confirm history, never
 *    erase it. Nothing is written back: the floor's home is the database.
 *
 * ── What is NOT here, on purpose ─────────────────────────────────────────────
 * No depth_score / citation-count time series. Reconstructing those means parsing
 * every historical revision of every entity, and inventing them from commit
 * subjects would be a fabrication wearing a chart's clothes. See history-types.ts.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  EdgeCountPoint,
  HistoryEvent,
  ProductHistory,
  SlugHistory,
  TimestampCache,
  TopologyHistory,
} from "../app/_platform/research/history-types";
import type { Edge } from "../app/_platform/research/types";
import { PRODUCTS_DIR, productsWithResearch } from "./_scan";

const ROOT = process.cwd();
const OUT_FILE = path.join(ROOT, "public", "topology-history.json");

/** Record separator — commit headers cannot be confused with numstat rows. */
const RS = "\x1e";

const git = (args: string[]): string =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** Repo-relative content paths, with the literal parens the route group keeps on disk. */
const contentPath = (product: string, ...rest: string[]) =>
  ["app", "(products)", product, "research", "content", ...rest].join("/");

const entitiesPath = (product: string) => contentPath(product, "entities");
const edgesPath = (product: string) => contentPath(product, "edges.json");

// ── git plumbing ────────────────────────────────────────────────────────────

/**
 * `a/{old => new}/b.json` and `old.json => new.json` are the two shapes numstat
 * uses for a rename. Both need unwinding to the path as it exists *now*.
 */
function renameTargets(raw: string): { before: string; after: string } {
  const braced = raw.match(/^(.*)\{(.*?) => (.*?)\}(.*)$/);
  if (braced) {
    const [, pre, from, to, post] = braced;
    return {
      before: `${pre}${from}${post}`.replace(/\/{2,}/g, "/"),
      after: `${pre}${to}${post}`.replace(/\/{2,}/g, "/"),
    };
  }
  const plain = raw.split(" => ");
  if (plain.length === 2) return { before: plain[0], after: plain[1] };
  return { before: raw, after: raw };
}

type RawEvent = HistoryEvent & { path: string };

/**
 * Every commit that touched any product's research content, in one walk.
 * Returns events keyed by the path the file has TODAY (renames resolved).
 */
function walkHistory(products: string[]): { byPath: Map<string, RawEvent[]>; commitsSeen: number } {
  const scope = products.flatMap((p) => [entitiesPath(p), edgesPath(p)]);
  const byPath = new Map<string, RawEvent[]>();
  if (!scope.length) return { byPath, commitsSeen: 0 };

  let out = "";
  try {
    out = git(["log", "-M", "--no-color", `--format=${RS}%ct|%H|%s`, "--numstat", "--", ...scope]);
  } catch {
    // No git, no commits yet, or an unborn HEAD. Every file then reads as uncommitted.
    return { byPath, commitsSeen: 0 };
  }

  /** old path → the path it became. Filled as we walk newest → oldest. */
  const renamedTo = new Map<string, string>();
  const canonical = (p: string): string => {
    let cur = p;
    for (let hops = 0; hops < 32; hops++) {
      const next = renamedTo.get(cur);
      if (!next || next === cur) break;
      cur = next;
    }
    return cur;
  };

  let ts = 0;
  let sha = "";
  let subject = "";
  let commitsSeen = 0;

  for (const line of out.split("\n")) {
    if (line.startsWith(RS)) {
      const [rawTs, rawSha, ...rest] = line.slice(RS.length).split("|");
      ts = Number(rawTs) || 0;
      sha = rawSha ?? "";
      subject = rest.join("|"); // a subject may legitimately contain '|'
      commitsSeen++;
      continue;
    }
    if (!line.trim() || !sha) continue;

    const [addRaw, delRaw, ...pathParts] = line.split("\t");
    if (pathParts.length === 0) continue;
    const { before, after } = renameTargets(pathParts.join("\t"));
    if (before !== after) renamedTo.set(before, canonical(after));

    const key = canonical(after);
    const event: RawEvent = {
      ts,
      sha,
      // "-" means binary. Not expected for JSON, but never let it become NaN.
      added: addRaw === "-" ? 0 : Number(addRaw) || 0,
      removed: delRaw === "-" ? 0 : Number(delRaw) || 0,
      subject,
      path: key,
    };
    const bucket = byPath.get(key);
    if (bucket) bucket.push(event);
    else byPath.set(key, [event]);
  }

  return { byPath, commitsSeen };
}

/**
 * The edge count at every commit that touched edges.json — read back from the
 * historical blob, so it is measured rather than guessed. One `cat-file --batch`
 * process handles all revisions across all products.
 */
function edgeTimelines(products: string[]): Map<string, EdgeCountPoint[]> {
  const timelines = new Map<string, EdgeCountPoint[]>();
  const wanted: { product: string; ts: number; sha: string; ref: string }[] = [];

  for (const product of products) {
    timelines.set(product, []);
    let log = "";
    try {
      log = git(["log", "--no-color", "--format=%ct|%H", "--", edgesPath(product)]);
    } catch {
      continue;
    }
    for (const line of log.split("\n")) {
      if (!line.trim()) continue;
      const [rawTs, sha] = line.split("|");
      if (!sha) continue;
      wanted.push({ product, ts: Number(rawTs) || 0, sha, ref: `${sha}:${edgesPath(product)}` });
    }
  }
  if (!wanted.length) return timelines;

  // `--batch` streams "<sha> blob <size>\n<contents>\n" per requested ref.
  //
  // Read it as a BUFFER, not a string. `size` is a count of BYTES; a JS string is
  // indexed in UTF-16 code units. Every em-dash in an edge note is 3 bytes and 1
  // code unit, so slicing the decoded string by `size` walks the cursor off the
  // end of the blob and silently desyncs every subsequent record. (It did: 21
  // revisions parsed as 8 before this was a Buffer.)
  const batch = execFileSync("git", ["cat-file", "--batch"], {
    cwd: ROOT,
    input: wanted.map((w) => w.ref).join("\n") + "\n",
    maxBuffer: 256 * 1024 * 1024,
  });

  let cursor = 0;
  for (const w of wanted) {
    const nl = batch.indexOf(0x0a, cursor); // "\n"
    if (nl === -1) break;
    const parts = batch.toString("utf8", cursor, nl).split(" ");
    if (parts[1] !== "blob") {
      // "missing" / "ambiguous" — the file did not exist at that commit.
      cursor = nl + 1;
      continue;
    }
    const size = Number(parts[2]) || 0;
    const body = batch.toString("utf8", nl + 1, nl + 1 + size);
    cursor = nl + 1 + size + 1; // trailing newline after the blob
    try {
      const parsed = JSON.parse(body) as { edges?: Edge[] };
      timelines.get(w.product)?.push({ ts: w.ts, sha: w.sha, count: parsed.edges?.length ?? 0 });
    } catch {
      /* a malformed historical edges.json is not worth failing the build over */
    }
  }

  for (const points of timelines.values()) points.sort((a, b) => a.ts - b.ts);
  return timelines;
}

// ── the floor ───────────────────────────────────────────────────────────────

/** Each product's pulled timestamps, keyed by product. A product with none is absent. */
function readFloor(products: string[]): TimestampCache {
  const out: TimestampCache = {};
  for (const product of products) {
    const f = path.join(PRODUCTS_DIR, product, "research", "content", "_timestamps.json");
    try {
      out[product] = JSON.parse(fs.readFileSync(f, "utf8")) as TimestampCache[string];
    } catch {
      /* no floor: git is the only record, or there is none */
    }
  }
  return out;
}

function isShallow(): boolean {
  try {
    return git(["rev-parse", "--is-shallow-repository"]).trim() === "true";
  } catch {
    return false;
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const started = Date.now();
const shallow = isShallow();
const products = productsWithResearch().sort();
const cache = readFloor(products);
const { byPath, commitsSeen } = walkHistory(products);
const timelines = edgeTimelines(products);

const nowSec = Math.floor(Date.now() / 1000);
const out: TopologyHistory = { generatedAt: new Date().toISOString(), shallow, products: {} };

for (const product of products) {
  const dir = path.join(PRODUCTS_DIR, product, "research", "content", "entities");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    files = [];
  }

  const entities: Record<string, SlugHistory> = {};
  const cached = cache[product] ?? {};
  let uncommittedCount = 0;
  let datedCount = 0;

  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    const key = `${entitiesPath(product)}/${file}`;
    const events = (byPath.get(key) ?? []).slice().sort((a, b) => a.ts - b.ts);
    const floor = cached[slug];

    let first_seen: number;
    let last_changed: number;
    let uncommitted = false;
    if (events.length && floor) {
      // Both records: min for first_seen, max for last_changed — a shallow clone can only confirm.
      first_seen = Math.min(floor.first_seen, events[0].ts);
      last_changed = Math.max(floor.last_changed, events[events.length - 1].ts);
    } else if (events.length) {
      first_seen = events[0].ts;
      last_changed = events[events.length - 1].ts;
    } else if (floor) {
      // The database's record. Git never saw this file, and that is by design.
      first_seen = floor.first_seen;
      last_changed = floor.last_changed;
    } else {
      // A file nothing has dated. It exists — it just has no past. Treat it as
      // added now, and SAY SO, rather than crashing or inventing a date.
      first_seen = nowSec;
      last_changed = nowSec;
      uncommitted = true;
    }
    if (uncommitted) uncommittedCount++;
    else datedCount++;

    entities[slug] = {
      first_seen,
      last_changed,
      commits: events.length,
      events: events.map(({ ts, sha, added, removed, subject }) => ({ ts, sha, added, removed, subject })),
      ...(uncommitted ? { uncommitted: true } : {}),
    };
  }

  const tracked = datedCount > 0;
  out.products[product] = {
    tracked,
    entities,
    edgeTimeline: timelines.get(product) ?? [],
  };
  const note = !tracked
    ? "  ← nothing dates these; first_seen = now"
    : uncommittedCount
      ? `  (${uncommittedCount} undated)`
      : Object.keys(cached).length
        ? "  (dated by the product database)"
        : "";
  console.log(
    `  ✓ ${product}: ${files.length} entities, ${Object.values(entities).reduce((n, e) => n + e.commits, 0)} commits, ` +
      `${out.products[product].edgeTimeline.length} edge revisions${note}`,
  );
}

// A shallow clone cannot see the beginning of git history. That only matters
// for a product whose corpus is committed; a database-dated corpus is unaffected.
if (shallow && products.some((p) => !cache[p])) {
  console.warn("  ! shallow clone — git history is truncated for any product without a pulled _timestamps.json.");
}

fs.mkdirSync(path.join(ROOT, "public"), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
console.log(
  `✓ build-topology-history → public/topology-history.json ` +
    `(${products.length} products, ${commitsSeen} commits walked, ${Date.now() - started}ms)`,
);
