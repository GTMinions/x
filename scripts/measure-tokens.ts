/**
 * measure-tokens — what a run actually spent, read off the API's own accounting.
 *
 * Wish #6 asked the receipt to show what the loop spent. The receipt has had the
 * row all along (`WishTimeline`), and it has always read "not recorded", because
 * no run has ever written a `tokens` block into its log. 613 logs, zero blocks.
 * The row was not broken. It was honest, and empty.
 *
 * It was empty for a good reason. The thing this replaces, `estimateTokens()`,
 * hashed the wish id and title into 40k–500k and printed the result next to a
 * model name. It moved when you renamed the wish. `routine.md` §2 draws the rule
 * from that corpse: **never write a token number the run did not measure.** Both
 * halves must be real counts or the block does not ship.
 *
 * So this script does not estimate. The worker writes a JSONL transcript per
 * session, and every assistant message in it carries the `usage` object the API
 * returned — `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`,
 * `output_tokens`. That is a measurement: the model's own bill, not our guess at
 * it. This sums those records and patches the block into a run log.
 *
 * Two things it is careful about, because both would make the number a lie:
 *
 *   Subagents are not in the main transcript. A run that fans out to the critic
 *   gate spends real money in sidechains, and those live in their own transcripts.
 *   We sum them too, and record their spend *separately* from the main loop's — so
 *   the claim "the subagents cost more than the loop did" is one the reader can
 *   check against the block rather than take from us.
 *
 *   `in` is every input token processed, and on a long session almost all of it is
 *   cache reads: cheap, but they are real tokens and they are counted. We carry the
 *   split into the log so the reader who opens it (the receipt links it, which is
 *   the point) sees what the headline is made of rather than assuming it is fresh
 *   context. It rarely is — the fresh share is typically a rounding error against
 *   the total.
 *
 * A note on the numbers in this file: they name the run they came from, and that
 * run's window is closed. A figure quoted from a run still in flight is stale
 * before anyone reads it — which is exactly how a fabricated fresh-token count got
 * past two review rounds while sitting next to real ones.
 *
 * It measures up to the moment it runs. The commit and the push that follow are
 * not in it. The block says so.
 *
 * One transcript is one *session*, not one *run*. A cron slot is a fresh session,
 * so the two coincide and the window can be left open. An interactive session that
 * runs several slots back to back is the case where they do not, and a count taken
 * without `--since` there would bill this run for the last one's work. So the
 * window is explicit, and the block records it.
 *
 *   pnpm tokens --run 2026-07-30T13-00 --since 2026-07-13T06:07:00Z
 *   pnpm tokens --since <iso> --until <iso>     print the totals, write nothing
 *   pnpm tokens                                 the whole session (correct for cron)
 */
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type Tally = { fresh: number; cacheRead: number; cacheCreate: number; out: number; messages: number };

const empty = (): Tally => ({ fresh: 0, cacheRead: 0, cacheCreate: 0, out: 0, messages: 0 });

const add = (t: Tally, u: Usage): void => {
  t.fresh += u.input_tokens ?? 0;
  t.cacheRead += u.cache_read_input_tokens ?? 0;
  t.cacheCreate += u.cache_creation_input_tokens ?? 0;
  t.out += u.output_tokens ?? 0;
  t.messages += 1;
};

const merge = (a: Tally, b: Tally): Tally => ({
  fresh: a.fresh + b.fresh,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheCreate: a.cacheCreate + b.cacheCreate,
  out: a.out + b.out,
  messages: a.messages + b.messages,
});

/** Every input token the run put through the model, cache reads included. */
const inputOf = (t: Tally) => t.fresh + t.cacheRead + t.cacheCreate;

type Window = { since?: number; until?: number };

/** Sum the `usage` the API returned on each assistant message inside the window.
 *  Anything that is not a usage record is skipped: a transcript we cannot parse
 *  contributes zero rather than throwing away the run's whole measurement.
 *
 *  A message with no timestamp is counted only when the window is open at both
 *  ends. Guessing which side of a boundary an undated message falls on would be
 *  the same sin as estimating it. */
async function tallyTranscript(file: string, w: Window): Promise<Tally> {
  const t = empty();
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return t;
  }
  const bounded = w.since !== undefined || w.until !== undefined;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line) as { message?: { usage?: Usage }; timestamp?: string };
      const u = d.message?.usage;
      if (!u || (u.input_tokens === undefined && u.output_tokens === undefined)) continue;

      const at = d.timestamp ? Date.parse(d.timestamp) : NaN;
      if (Number.isNaN(at)) {
        if (bounded) continue; // undated: cannot place it in the window, so do not claim it
      } else {
        if (w.since !== undefined && at < w.since) continue;
        if (w.until !== undefined && at > w.until) continue;
      }
      add(t, u);
    } catch {
      // a truncated final line on a live session is normal; it is one message, not a reason to fail
    }
  }
  return t;
}

async function newest(dir: string, ext: string): Promise<string[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith(ext));
  } catch {
    return [];
  }
  const withTime = await Promise.all(
    names.map(async (f) => {
      const full = path.join(dir, f);
      try {
        return { full, at: (await stat(full)).mtimeMs };
      } catch {
        return { full, at: 0 };
      }
    }),
  );
  return withTime.sort((a, b) => b.at - a.at).map((x) => x.full);
}

/**
 * The transcripts for the session that is running this script.
 *
 * Both paths come from the environment and neither has a default. Where a
 * worker keeps its transcripts depends on what the worker is, and this
 * repository deliberately does not know or record that — an operator points it
 * at their own directory and nothing here implies whose it is.
 */
async function findTranscripts(): Promise<{ main: string[]; sub: string[] }> {
  const projectDir = process.env.WORKER_SESSION_DIR;
  if (!projectDir) {
    console.error(
      "measure-tokens: set WORKER_SESSION_DIR to the directory holding this session's " +
        ".jsonl transcripts (and WORKER_TASKS_DIR for subagent .output files).",
    );
    process.exit(1);
  }
  const main = await newest(projectDir, ".jsonl");

  const sub: string[] = [];
  const tasksDir = process.env.WORKER_TASKS_DIR;
  if (tasksDir) sub.push(...(await newest(tasksDir, ".output")));
  return { main: main.slice(0, 1), sub };
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function bound(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t)) {
    console.error(`measure-tokens: ${name} is not a date I can parse: ${v}`);
    process.exit(1);
  }
  return t;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const runId = flag(argv, "--run");
  const w: Window = { since: bound(flag(argv, "--since"), "--since"), until: bound(flag(argv, "--until"), "--until") };

  const { main: mains, sub: subs } = await findTranscripts();
  if (!mains.length) {
    console.error("measure-tokens: found no session transcript. Nothing was measured, so nothing is written.");
    console.error("  Set WORKER_SESSION_DIR to the directory holding this session's .jsonl.");
    process.exit(1);
  }

  const mainTally = merge(empty(), await tallyTranscript(mains[0], w));
  let subTally = empty();
  let subFiles = 0;
  for (const f of subs) {
    const t = await tallyTranscript(f, w);
    if (t.messages) {
      subTally = merge(subTally, t);
      subFiles += 1;
    }
  }

  const all = merge(mainTally, subTally);
  const iso = (n?: number) => (n === undefined ? null : new Date(n).toISOString());
  const block = {
    in: inputOf(all),
    out: all.out,
    measured: {
      source: "worker session transcripts — the `usage` the API returned on each assistant message",
      window: { since: iso(w.since), until: iso(w.until) },
      // Split, so that "the critics cost more than the loop" is checkable here rather
      // than asserted in a comment. A block that folded them together could not settle it.
      main: { messages: mainTally.messages, in: inputOf(mainTally), out: mainTally.out },
      subagents: {
        transcripts: subFiles,
        messages: subTally.messages,
        in: inputOf(subTally),
        out: subTally.out,
      },
      input_detail: { fresh: all.fresh, cache_read: all.cacheRead, cache_creation: all.cacheCreate },
      note:
        "Measured at run close; the commit, push and deploy that follow are not counted. `in` is every input " +
        "token processed and nearly all of it is cache reads — see input_detail. `window` bounds the transcript " +
        "to this run: a session that ran more than one slot would otherwise bill this run for the last one's work.",
    },
  };

  const pct = inputOf(all) ? ((all.cacheRead / inputOf(all)) * 100).toFixed(1) : "0";
  const win = w.since || w.until ? `${iso(w.since) ?? "session start"} → ${iso(w.until) ?? "now"}` : "whole session";
  const pad = (n: number) => n.toLocaleString().padStart(14);
  console.log(`  window           ${win}`);
  console.log(`  main loop        ${String(mainTally.messages).padStart(4)} msgs   in ${pad(inputOf(mainTally))}   out ${pad(mainTally.out)}`);
  console.log(`  subagents        ${String(subTally.messages).padStart(4)} msgs   in ${pad(inputOf(subTally))}   out ${pad(subTally.out)}   (${subFiles} transcripts)`);
  console.log(`  ────`);
  console.log(`  tokens in        ${block.in.toLocaleString()}  (${pct}% cache reads, ${all.fresh.toLocaleString()} fresh)`);
  console.log(`  tokens out       ${block.out.toLocaleString()}`);
  if (!all.messages) {
    console.error("\nmeasure-tokens: the window caught no messages. Nothing measured, so nothing is written.");
    process.exit(1);
  }

  if (!runId) {
    console.log("\n  No --run given, so no log was touched. Pass --run <run-id> to write the block.");
    return;
  }

  const logFile = path.join(process.cwd(), "cronjobs", "logs", `${runId}.json`);
  let log: Record<string, unknown>;
  try {
    log = JSON.parse(await readFile(logFile, "utf8")) as Record<string, unknown>;
  } catch {
    console.error(`\nmeasure-tokens: no log at cronjobs/logs/${runId}.json. Write the log first, then measure into it.`);
    process.exit(1);
  }

  log.tokens = block;
  await writeFile(logFile, `${JSON.stringify(log, null, 2)}\n`);
  console.log(`\n  ✓ wrote the tokens block into cronjobs/logs/${runId}.json`);
}

void main();
