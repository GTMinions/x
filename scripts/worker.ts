/**
 * worker — announce, claim one wish, report what it cost.
 *
 *   pnpm worker next                          take the next wish
 *   pnpm worker ship   <n> --run <run-id>     close it, report the spend
 *   pnpm worker report <n> --run <run-id>     spend only, once it is known
 *   pnpm worker drop   <n>                    put it back
 *
 * The instructions a worker follows are in `cronjobs/worker.md`, not here.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { hostname, userInfo } from "node:os";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

/** Next does not read `.env.local`, and the store needs it. */
function loadEnv(): void {
  for (const name of [".env.local", ".env.production.local"]) {
    const f = path.join(ROOT, name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m || process.env[m[1]!]) continue;
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}
// Static: tsx compiles this to CJS, where top-level await is a build error.
// Safe because the store reads its environment lazily, inside the call.
import { claimWish, releaseClaim, listAllDbWishes, updateDbWish, wishStoreError } from "../app/_platform/wishes/db";
import { workable, blockerOf } from "../app/_platform/queue";
import { stageLabel } from "../app/_platform/wishes";
type Wish = import("../app/_platform/wishes").Wish;

/** Stable across restarts, so a worker can re-take its own lease. `WORKER_ID`
 *  overrides it — several workers on one machine need distinct ids. */
function workerId(): string {
  const explicit = process.env.WORKER_ID?.trim();
  if (explicit) return explicit;
  return `${userInfo().username}@${hostname()}`.toLowerCase().replace(/[^a-z0-9@.-]/g, "-");
}

const PLATFORM = process.env.PLATFORM_URL?.replace(/\/$/, "") ?? "";
const TOKEN = process.env.WISH_WORKER_TOKEN ?? "";

/** Best effort: an unreachable registry must not stop work. */
async function announce(): Promise<string> {
  const id = workerId();
  if (!PLATFORM || !TOKEN) return id;
  try {
    await fetch(`${PLATFORM}/api/internal/workers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": TOKEN },
      body: JSON.stringify({ workerId: id, label: process.env.WORKER_LABEL ?? null }),
    });
  } catch {
    // Silent: an unreachable registry is not this run's problem.
  }
  return id;
}

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

/** Fallback order, used when the platform is unreachable. */
const rank = (a: Wish, b: Wish) => {
  const p = (w: Wish) => (w.priority === "p0" ? 0 : w.priority === "p1" ? 1 : w.priority === "p2" ? 2 : 3);
  return p(a) - p(b) || b.votes - a.votes || b.id - a.id;
};

/** The platform's order, which knows owners and tiers. Null when unreachable. */
async function orderedIds(): Promise<{ ids: number[]; ceilingTokens: number | null } | null> {
  if (!PLATFORM || !TOKEN) return null;
  try {
    const res = await fetch(`${PLATFORM}/api/internal/queue`, { headers: { "x-worker-token": TOKEN } });
    if (!res.ok) return null;
    const body = (await res.json()) as { queue?: { id: number }[]; ceilingTokens?: number };
    if (!Array.isArray(body.queue)) return null;
    return {
      ids: body.queue.map((q) => q.id),
      ceilingTokens: Number.isFinite(body.ceilingTokens) ? Number(body.ceilingTokens) : null,
    };
  } catch {
    return null;
  }
}

async function next(): Promise<void> {
  const id = await announce();
  const all = await listAllDbWishes();
  if (!all) return fail(`Could not read wishes: ${wishStoreError() ?? "no product database is configured."}`);

  // `workable` drops trackers, unapproved and blocked wishes. It cannot know
  // who holds a live lease — the claim below settles that.
  const byId = new Map(workable(all).map((w) => [w.id, w]));
  const order = await orderedIds();
  const queue = order
    ? order.ids.map((id) => byId.get(id)).filter((w): w is Wish => Boolean(w))
    : [...byId.values()].sort(rank);
  if (!order) console.log("(platform unreachable — using the board's own order, not tier order)");
  if (!queue.length) {
    console.log("Nothing to work. The board is empty or everything is claimed, blocked, or waiting on approval.");
    return;
  }

  for (const w of queue) {
    const res = await claimWish(w.scope, w.id, id);
    if (!res.ok) continue; // somebody else has it; try the next one

    const blocker = blockerOf(all, w);
    console.log(`\n── wish #${w.id} · ${w.scope} ──────────────────────────────`);
    console.log(`  ${w.title}`);
    if (w.body.trim()) console.log(`\n${w.body.trim().split("\n").map((l) => "  " + l).join("\n")}`);
    console.log(`\n  filed by ${w.nickname} · ${w.createdAt} · was ${stageLabel(w.status)}`);
    if (blocker) console.log(`  ⚠ blocked by #${blocker.id} — this should not have been claimable; stop and report it.`);
    console.log(`  claimed by ${id}\n`);
    console.log(`  Branch:  git checkout -b wish/${w.id}`);
    // Points at the worker doctrine rather than the whole loop: somebody who ran
    // this directly has not read either, and one wish is the smaller thing to read.
    console.log(`  Doctrine: read cronjobs/worker.md before editing anything.`);
    console.log(`  Scope:   ACTIVE_PRODUCT=${w.scope} — the pre-commit hook enforces it.`);
    if (order?.ceilingTokens) {
      const m = (order.ceilingTokens / 1e6).toFixed(0);
      console.log(`  Budget:  ${m}M tokens. Past it, split rather than running on:`);
      console.log(`             pnpm wishes --split ${w.id} --into "…" --into "…"`);
    }
    console.log(`\n  When it is done:   pnpm worker ship ${w.id} --run <run-id>`);
    console.log(`  If you cannot:     pnpm worker drop ${w.id}\n`);
    return;
  }

  console.log(`${queue.length} wish(es) look workable but every one is already claimed by another worker.`);
}

async function ship(id: number, runId: string): Promise<void> {
  const worker = await announce();
  const all = await listAllDbWishes();
  const w = all?.find((x) => x.id === id);
  if (!w) return fail(`No wish #${id} in any product database.`);

  const updated = await updateDbWish(
    w.scope,
    id,
    (cur: Wish) => ({ ...cur, status: "done" as const, needsApproval: false, closedAt: cur.closedAt ?? new Date().toISOString() }),
    { kind: "update", body: `Shipped by run \`${runId}\` (worker ${worker}).`, at: new Date().toISOString() },
  );
  if (!updated) return fail(`Could not ship #${id}: ${wishStoreError() ?? "the write was rejected."}`);

  console.log(`Shipped #${id} — ${updated.title}`);
  console.log(`  ${await report(id, runId, worker, w.scope)}`);
  console.log(`\n  Open a pull request — a wish's work is not merged by the run that did it:`);
  console.log(`    git push -u origin wish/${id} && gh pr create --fill`);
}

/** Keyed `<wish>:<run-id>`, so a retry records once and a second run records
 *  as the extra work it is. */
async function report(wishId: number, runId: string, worker: string, scope: string): Promise<string> {
  if (!PLATFORM || !TOKEN) return "usage not reported (set PLATFORM_URL and WISH_WORKER_TOKEN)";

  // Reported even when the log has no counts. The endpoint records the
  // FULFILMENT before it looks at the tokens — a wish was built either way, and
  // skipping the call would make "no token report" the way to build outside the
  // daily guarantee. Absent counts still charge nothing.
  const usage = readUsage(runId) ?? { model: null, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };

  try {
    const res = await fetch(`${PLATFORM}/api/internal/usage`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": TOKEN },
      body: JSON.stringify({ ...usage, wishId, scope, workerId: worker, idempotencyKey: `${wishId}:${runId}` }),
    });
    const body = (await res.json().catch(() => ({}))) as { recorded?: boolean; why?: string; error?: string };
    if (!res.ok) return `usage NOT reported — ${res.status} ${body.error ?? ""}`;
    return body.recorded ? "usage charged to the filer" : `usage not charged (${body.why ?? "already recorded"})`;
  } catch (err) {
    return `usage NOT reported — ${(err as Error).message}`;
  }
}

/** Absent counts report nothing rather than zero. */
function readUsage(runId: string): Record<string, unknown> | null {
  try {
    const log = JSON.parse(fs.readFileSync(path.join(ROOT, "cronjobs", "logs", `${runId}.json`), "utf8"));
    const t = log.tokens;
    if (!t || typeof t !== "object") return null;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
      model: typeof log.model === "string" ? log.model : null,
      inputTokens: num(t.input ?? t.in),
      cacheReadTokens: num(t.cache_read ?? t.cacheRead),
      cacheWriteTokens: num(t.cache_write ?? t.cacheWrite),
      outputTokens: num(t.output ?? t.out),
    };
  } catch {
    return null;
  }
}

/**
 * Report spend separately from shipping. A run cannot know its own cost until it
 * has finished, so a supervising harness fills the counts in and calls this.
 * `ship` sends nothing when the log has no counts, so the two compose.
 */
async function reportOnly(id: number, runId: string): Promise<void> {
  const worker = await announce();
  const all = await listAllDbWishes();
  const w = all?.find((x) => x.id === id);
  if (!w) return fail(`No wish #${id}.`);
  console.log(await report(id, runId, worker, w.scope));
}

async function drop(id: number): Promise<void> {
  const worker = await announce();
  const all = await listAllDbWishes();
  const w = all?.find((x) => x.id === id);
  if (!w) return fail(`No wish #${id}.`);
  const ok = await releaseClaim(w.scope, id, worker);
  console.log(ok ? `Released #${id} — back on the board.` : `#${id} is not yours to release.`);
}

const USAGE = `pnpm worker next
       pnpm worker ship   <n> --run <run-id>
       pnpm worker report <n> --run <run-id>   (spend only, once the run's cost is known)
       pnpm worker drop   <n>`;

async function main(): Promise<void> {
  loadEnv();

  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flag = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] ?? null : null;
  };

  if (cmd === "next") return next();
  if (cmd === "ship") {
    const n = Number(argv[1]);
    const run = flag("run");
    if (!Number.isInteger(n)) fail(`ship wants a wish number. ${USAGE}`);
    if (!run) fail(`ship needs --run <run-id>, so the wish links to the run that did it. ${USAGE}`);
    return ship(n, run!);
  }
  if (cmd === "report") {
    const n = Number(argv[1]);
    const run = flag("run");
    if (!Number.isInteger(n)) fail(`report wants a wish number. ${USAGE}`);
    if (!run) fail(`report needs --run <run-id>. ${USAGE}`);
    return reportOnly(n, run!);
  }
  if (cmd === "drop") {
    const n = Number(argv[1]);
    if (!Number.isInteger(n)) fail(`drop wants a wish number. ${USAGE}`);
    return drop(n);
  }
  console.log(USAGE);
  process.exit(cmd ? 1 : 0);
}

main().then(() => process.exit(0), (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
