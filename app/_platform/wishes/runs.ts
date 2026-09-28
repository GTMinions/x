/**
 * What the build loop actually spent on a wish.
 *
 * The receipt used to print a token count. It came from `estimateTokens()`, a
 * djb2 hash of the wish id and title mapped into 40k–500k, labelled "estimate"
 * and rendered next to a model name. It moved when you renamed the wish. It was
 * not a measurement of anything, and no reader could tell — which makes it worse
 * than an empty field. `citation-discipline` is written about research prose but
 * the rule is the same one: a number ships when it is earned, dated, and
 * falsifiable. That one was none of the three. It is gone.
 *
 * This module is the honest replacement. It reads the only record of the loop's
 * work that exists — the run logs the cron writes to `cronjobs/logs/*.json` — and
 * answers two questions about a wish:
 *
 *   which run worked it?   → an explicit claim in that run's log, or nothing
 *   what did the run cost? → the log's `tokens` block, or nothing
 *
 * For 613 runs the answer to the second was nothing — not one log carried a
 * `tokens` block — so the receipt said "not recorded". That was the honest output
 * of an empty record, not a bug, and it stayed that way until a run could measure
 * itself without guessing. `scripts/measure-tokens.ts` is that: it sums the `usage`
 * the API returned on each assistant message of the session, subagents included,
 * and patches the block in. The UI never changed to accommodate it. That is the
 * whole design: the UI reports the record, and when the record is empty it says so
 * instead of generating a number.
 *
 * The linkage a log can carry, in order of preference:
 *
 *   "wishes": [5, 12]        a structured list of the wish ids the run worked
 *   "wish_first": "… #5 …"   the loop's prose claim, when it names the issue
 *
 * and the cost:
 *
 *   "tokens": { "in": 1200000, "out": 84000 }     (also accepts input/output)
 *
 * Nothing here throws. A missing directory, a mangled log, a read that fails on a
 * cold serverless boot — each degrades to "no run found", never to a 500 on a
 * page whose job is to show a wish.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** Tokens the run recorded. `null` means the run kept no record — not zero. */
export type RunTokens = {
  in: number;
  out: number;
  /** Of `in`, how much was cache reads. On a long session most of it is, and a
   *  headline that did not say so would read as fresh context. Absent when the
   *  run recorded a total without breaking it down. */
  cacheRead?: number;
};

export type WishRun = {
  /** The log's own id, e.g. "2026-07-30T10-00". */
  runId: string;
  at: string;
  /** How this run got tied to the wish. Shown, so the link is auditable. */
  via: "wishes-field" | "wish-first";
  tokens: RunTokens | null;
  /** The log file this was read out of, on github.com. Null when the repo is not
   *  configured. It is the point of the citation: the reader can open the record
   *  the receipt is quoting and check it against what we printed. */
  logUrl: string | null;
};

const LOG_DIR = path.join(process.cwd(), "cronjobs", "logs");
/** The logs are static once written, but a live cron appends one an hour. */
const TTL_MS = 60_000;

type Index = Map<number, WishRun[]>;
let cache: { at: number; index: Index } | null = null;
let inFlight: Promise<Index> | null = null;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** A `tokens` block, however the loop spells it. Both halves must be present and
 *  be numbers — a half-filled block is not a measurement, so it reads as none. */
function readTokens(log: Record<string, unknown>): RunTokens | null {
  const t = log.tokens;
  if (!t || typeof t !== "object") return null;
  const b = t as Record<string, unknown>;
  const i = num(b.in) ?? num(b.input) ?? num(b.input_tokens);
  const o = num(b.out) ?? num(b.output) ?? num(b.output_tokens);
  if (i === null || o === null) return null;

  // `measure-tokens` records what the input is made of. Optional: a run that wrote
  // a bare total is still a measurement, it just cannot tell the reader the split.
  const detail = (b.measured as Record<string, unknown> | undefined)?.input_detail;
  const cacheRead = detail && typeof detail === "object" ? num((detail as Record<string, unknown>).cache_read) : null;

  return { in: i, out: o, ...(cacheRead !== null ? { cacheRead } : {}) };
}

/** The wish ids a run claims it worked. A bare "#5" in the loop's own `wish_first`
 *  line is that run saying it shipped wish 5 — evidence enough to link the two.
 *  Anything vaguer is not: we do not fuzzy-match a wish title against prose and
 *  call the result a receipt. */
function readWishIds(log: Record<string, unknown>): { ids: number[]; via: WishRun["via"] } {
  const structured = log.wishes ?? log.wish_ids;
  if (Array.isArray(structured)) {
    const ids = structured.map(num).filter((n): n is number => n !== null);
    if (ids.length) return { ids, via: "wishes-field" };
  }
  const first = log.wish_first;
  if (typeof first === "string") {
    const ids = [...first.matchAll(/#(\d{1,6})\b/g)].map((m) => Number(m[1]));
    if (ids.length) return { ids: [...new Set(ids)], via: "wish-first" };
  }
  return { ids: [], via: "wishes-field" };
}

async function buildIndex(): Promise<Index> {
  const index: Index = new Map();
  let files: string[];
  try {
    files = (await readdir(LOG_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    // No logs bundled (or no loop running at all). A wish simply has no run.
    return index;
  }

  await Promise.all(
    files.map(async (file) => {
      let log: Record<string, unknown>;
      try {
        log = JSON.parse(await readFile(path.join(LOG_DIR, file), "utf8")) as Record<string, unknown>;
      } catch {
        return; // one unreadable log must not cost us the other 610
      }
      const { ids, via } = readWishIds(log);
      if (!ids.length) return;

      const run: WishRun = {
        runId: typeof log.run_id === "string" ? log.run_id : file.replace(/\.json$/, ""),
        at: typeof log.timestamp === "string" ? log.timestamp : "",
        via,
        tokens: readTokens(log),
        // Always null. This used to link to the log on github.com, which could
        // never have worked: `cronjobs/logs/` is gitignored precisely so that
        // whatever a run happened to observe is not published. A link to a file
        // that is deliberately absent is worse than no link, so the timeline
        // shows the run id and stops there.
        logUrl: null,
      };
      for (const id of ids) index.set(id, [...(index.get(id) ?? []), run]);
    }),
  );

  for (const runs of index.values()) runs.sort((a, b) => (a.at < b.at ? -1 : 1));
  return index;
}

async function getIndex(): Promise<Index> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.index;
  inFlight ??= buildIndex()
    .then((index) => {
      cache = { at: Date.now(), index };
      return index;
    })
    .catch(() => cache?.index ?? new Map<number, WishRun[]>())
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Every run that claims it worked this wish, oldest first. Empty when none does. */
export async function runsForWish(id: number): Promise<WishRun[]> {
  return (await getIndex()).get(id) ?? [];
}

/**
 * What the loop has spent on a product, summed over every run log that names it.
 *
 * Same honesty contract as the per-wish receipt: a log's `product` field says
 * which scopes the run worked ("gtm", "site", "gtm+site+ai-edu"); its `tokens`
 * block says what the run measured, and most logs have none. So the answer has
 * two parts — the sum of what WAS measured, and the count of runs that kept no
 * record — and the second is not decoration: a total shown without it would
 * read as the cost of everything when it is the cost of the measured slice.
 * `scope: "site"` sums every log, because the site board is every product's.
 */
export type ProductUsage = {
  tokens: RunTokens | null;
  meteredRuns: number;
  totalRuns: number;
};

export async function productUsage(scope: string): Promise<ProductUsage> {
  let files: string[];
  try {
    files = (await readdir(LOG_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return { tokens: null, meteredRuns: 0, totalRuns: 0 };
  }
  let sum: RunTokens | null = null;
  let metered = 0;
  let total = 0;
  await Promise.all(
    files.map(async (file) => {
      let log: Record<string, unknown>;
      try {
        log = JSON.parse(await readFile(path.join(LOG_DIR, file), "utf8")) as Record<string, unknown>;
      } catch {
        return;
      }
      const product = typeof log.product === "string" ? log.product : "";
      if (scope !== "site" && !product.split("+").map((s) => s.trim()).includes(scope)) return;
      total += 1;
      const t = readTokens(log);
      if (!t) return;
      metered += 1;
      sum = sum
        ? {
            in: sum.in + t.in,
            out: sum.out + t.out,
            ...(sum.cacheRead !== undefined || t.cacheRead !== undefined
              ? { cacheRead: (sum.cacheRead ?? 0) + (t.cacheRead ?? 0) }
              : {}),
          }
        : t;
    }),
  );
  return { tokens: sum, meteredRuns: metered, totalRuns: total };
}
