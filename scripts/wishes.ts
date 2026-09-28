/**
 * wishes — the loop's read/write handle on the wish backlog.
 *
 * A wish is a row in the database of the product it names (see
 * app/_platform/wishes/db.ts). Before this script the loop had no way to see one: the
 * routine said "pull those too" and nothing pulled. A user filed a wish and it sat.
 *
 *   pnpm wishes                        every OPEN wish, grouped by scope
 *   pnpm wishes --scope gtm            one scope
 *   pnpm wishes --claim 4              take the atomic lease on ONE named wish
 *   pnpm wishes --ship 4 --run <id>    close as done + report the run's spend
 *
 * Claim and ship share their machinery with `pnpm worker` — same atomic lease,
 * same usage report, same idempotency key — so the two entrances cannot drift.
 * The difference is selection: `worker next` takes the top of the queue,
 * `--claim <n>` takes the wish you name.
 *
 * With no product database configured it prints one line saying wishes are not
 * persisted and exits 0. x runs with zero secrets; a backlog tool that crashes without
 * one is a tool the loop learns to skip.
 *
 * Two things this script deliberately does NOT do:
 *
 * 1. It does not talk to a database itself. Every call goes through the store in
 *    app/_platform/wishes/db.ts, so the CLI and the wishlist UI can never drift
 *    into disagreeing about what a wish is.
 *
 * 2. It does not invent a cost. `--ship` reads the run log's `tokens` block and, when
 *    the run recorded none, writes "not recorded" onto the wish. Today no run log
 *    carries one, so that is what every receipt will say until a run starts recording
 *    it. A fabricated number is worse than an absent one (`.claude/skills/citation-discipline`).
 *    The token contract is `app/_platform/wishes/runs.ts` — `in` + `out`, both halves
 *    or nothing. This script reads one named run's log; that module indexes every log
 *    by wish. They must agree, so the rule is copied deliberately and pointed at here.
 *
 * The link is two-way: `--ship` writes the run id onto the wish, and the run log's own
 * `"wishes": [n]` field points back. See §1.6 of cronjobs/routine.md.
 */
import { execFileSync } from "node:child_process";
import { hostname, userInfo } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  claimWish,
  configuredScopes,
  createDbWish,
  findDbWish,
  getDbWish,
  listAllDbWishes,
  updateDbWish,
  wishDbConfigured,
  wishStoreError,
} from "../app/_platform/wishes/db";
import { listProducts as primeRegistry } from "../app/lib/registry/core";
import { isClosed, stageLabel, type Wish } from "../app/_platform/wishes";
import {
  SPLIT_DOCTRINE,
  childrenOf,
  isOpen as queueIsOpen,
  parentIds,
  workable,
} from "../app/_platform/queue";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── env ──────────────────────────────────────────────────────────────────────
// next dev/build load .env.local; a bare `tsx` process does not. An explicitly-set
// variable always wins over the file — including one set to empty, which is how you
// simulate an unconfigured box: `PRODUCT_DB_SITE_URL= TURSO_API_TOKEN= pnpm wishes`.
function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    return; // No .env.local (CI, Vercel). The real environment is authoritative.
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rest] = m;
    if (key in process.env) continue;
    let value = rest.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// ── the wish, read for the loop ──────────────────────────────────────────────

const OPEN = (w: Wish) => !isClosed(w.status);

/** A wish filed from a research page's "too thin" button routes to the researcher, and its
 *  gate is the depth ladder. SectionDive writes `Deepen <entity> · <Section>` over a body
 *  naming the entity in a [[slug]] pill; both have to be there before we claim to know what
 *  kind of wish this is. */
type Dive = { entity: string; section: string };
function sectionDive(w: Wish): Dive | null {
  if (!/^Deepen\s/.test(w.title)) return null;
  const entity = /\[\[([\w.-]+)\]\]/.exec(w.body)?.[1];
  if (!entity) return null;
  const section = w.title.split("·").slice(1).join("·").trim() || /\*\*(.+?)\*\*/.exec(w.body)?.[1] || "a section";
  return { entity, section };
}

/** The wish's own acceptance test, when the filer wrote one. Reads the line that opens
 *  with "done when" — SectionDive writes one, and the wish form invites one. */
function doneWhen(body: string): string | null {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*[*#>\s-]*\**\s*done when\b\**\s*:?\s*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    let text = m[1].trim();
    // "Done when:" alone on its line — the test is the paragraph under it.
    for (let j = i + 1; !text && j < lines.length && j <= i + 3; j++) text = lines[j].trim();
    if (text) return text.replace(/\s+/g, " ");
  }
  return null;
}

/** `getIssueWish` returns null for two very different things: the wish does not exist,
 *  and GitHub would not answer. Told apart by `githubLastError()`, which the store sets
 *  on a failed call and clears on a good one. Conflating them tells a run that a wish a
 *  user filed is not there — the exact failure this whole script exists to end.
 *
 *  The retry is not decoration. GitHub secondary-rate-limits a burst of writes, so a
 *  claim issued seconds after a read gets one 403; a single backoff clears it. */
async function loadWish(id: number, scope?: string): Promise<Wish> {
  await primeRegistry(); // the wish scopes are the registry's products
  const w = scope ? await getDbWish(scope, id) : await findDbWish(id);
  // The loop is the ONE consumer that enforces `needsApproval`, and the flag is
  // now just the `triage` stage read back — a wish waiting on a human. Nothing
  // to reconcile on read any more: an approval moves the stage, and the stage is
  // the only record of it.
  if (w) return w;

  // Ids are per-product now, so "not found" has a second cause that GitHub never
  // had: the right number in the wrong database. Say so, rather than reporting
  // a wish the user is looking at as missing.
  const err = wishStoreError();
  if (err) throw new Error(`Could not read wish #${id}: ${err}`);
  const where = scope ? `\`${scope}\`` : `any of ${configuredScopes().join(", ") || "no configured product"}`;
  throw new Error(
    `No wish #${id} in ${where}. Wish numbers are per-product — check with \`pnpm wishes --scope <slug>\`.`,
  );
}

const prio = (w: Wish) => w.priority ?? "—";

/** p0 → p1 → p2 → unranked, then newest. An unranked wish sorts last but is still on
 *  the list: nobody ranking it does not mean nobody asked for it. */
const RANK: Record<string, number> = { p0: 0, p1: 1, p2: 2 };
const rankOf = (w: Wish) => (w.priority ? RANK[w.priority] : 3);
const rank = (a: Wish, b: Wish) => rankOf(a) - rankOf(b) || b.id - a.id;

// ── list ─────────────────────────────────────────────────────────────────────

function list(wishes: Wish[], scope: string | null): void {
  const open = wishes
    .filter(OPEN)
    .filter((w) => !scope || w.scope === scope);

  if (!open.length) {
    console.log(scope ? `No open wishes in scope "${scope}".` : "No open wishes. The file backlog is the queue.");
    return;
  }

  const scopes = [...new Set(open.map((w) => w.scope))].sort();
  const parents = parentIds(wishes);
  const ready = workable(wishes).length;
  console.log(`${open.length} open wish${open.length === 1 ? "" : "es"} · ${configuredScopes().join(", ") || "in-memory"} · priority first, then newest`);
  console.log(`  ${ready} ready to work — the rest are claimed, awaiting approval, or trackers for a split.\n`);

  for (const s of scopes) {
    console.log(`  scope:${s}`);
    for (const w of open.filter((x) => x.scope === s).sort(rank)) {
      const dive = sectionDive(w);
      // A tracker is not work and a slice is not the whole ask; both mislead if
      // they print like an ordinary wish.
      const kind = parents.has(w.id)
        ? `  [tracker → ${childrenOf(wishes, w.id).map((c) => `#${c.id}`).join(" ")}]`
        : typeof w.parentId === "number"
          ? `  [slice of #${w.parentId}]`
          : "";
      const tag = `${kind}${dive ? "  [research-deepen]" : ""}`;
      console.log(
        `    #${String(w.id).padEnd(4)} ${w.status.padEnd(12)} ${prio(w).padEnd(3)} ${w.title}${tag}`,
      );
      if (dive) console.log(`         → researcher · entity ${dive.entity} · section "${dive.section}"`);
      const dw = doneWhen(w.body);
      console.log(`         done when: ${dw ?? "not stated — decide it before you claim"}`);
      console.log(`         ${w.issueUrl ?? ""}`);
    }
    console.log("");
  }

  console.log("Claim before you work it:  pnpm wishes --claim <n>");
  console.log("Too big for one slot:      pnpm wishes --split <n> --into \"...\"");
  console.log("Ship it at run close:      pnpm wishes --ship <n> --run <run-id>");
}

// ── split ────────────────────────────────────────────────────────────────────

/**
 * Break a wish too big for one sitting into children.
 *
 * Three problems this solves, none of them about queue order: the filer sees
 * nothing until the whole thing is done; the diff arrives too large for the
 * critics to review usefully; and an interrupted run loses everything instead
 * of one slice.
 *
 * Children inherit the parent's scope and filer, so a split changes how
 * the work arrives and nothing about whose work it is.
 *
 * The parent stays open as a tracker — `workable` skips it, so the loop never
 * claims a wish whose real tasks live elsewhere — and closes itself when the
 * last child closes (see `ship`).
 */
async function split(id: number, titles: string[]): Promise<number> {
  if (!titles.length) return fail(`--split needs at least one --into "<title>". ${USAGE}`);

  const parent = await loadWish(id);
  if (!OPEN(parent)) return fail(`Wish #${id} is already ${parent.status}. Nothing to split.`);

  const all = (await listAllDbWishes()) ?? [];
  const existing = childrenOf(all, id);
  if (existing.length) {
    console.log(`Wish #${id} is already split into ${existing.length}:`);
    for (const c of existing) console.log(`    #${c.id} ${c.status.padEnd(12)} ${c.title}`);
    console.log("\nFile more slices with another --split, or work the open children.");
  }

  const made: Wish[] = [];
  for (const title of titles) {
    const child = await createDbWish({
      scope: parent.scope,
      title: title.trim().slice(0, 160),
      // The child says where it came from in prose as well as in the parent_id
      // column: someone who lands on it from a notification sees one slice of
      // something bigger, not an orphan task with no context.
      body: `One slice of #${id} — ${parent.title}.\n\nSplit out so it can be built and reviewed on its own; see the parent for the whole ask.`,
      // Ready, not triage: the parent was already accepted, and making someone
      // re-approve each slice of work they agreed to is how a split stalls.
      status: "ready",
      role: parent.role,
      nickname: parent.nickname,
      source: parent.source,
      votes: parent.votes,
      priority: parent.priority,
      needsApproval: false,
      followups: 0,
      media: [],
      comments: [],
      createdAt: new Date().toISOString().slice(0, 10),
      closedAt: null,
      parentId: id,
    });
    if (!child) return fail(`Could not create a slice of #${id}: ${wishStoreError() ?? "the write was rejected."}`);
    made.push(child);
    console.log(`  + #${child.id} ${child.title}`);
  }

  await updateDbWish(
    parent.scope,
    id,
    (cur: Wish) => ({ ...cur, status: "backlog" as const }),
    {
      kind: "update",
      at: new Date().toISOString(),
      body:
        `Split into ${made.length} slice${made.length === 1 ? "" : "s"}: ${made.map((c) => `#${c.id}`).join(", ")}.\n\n` +
        "This issue is now a tracker — the worker builds the slices, not this. It closes itself when the last one closes. " +
        "Splitting changes how the work arrives, not what was asked for or who asked for it.",
    },
  );
  console.log(`\nSplit #${id} into ${made.length}. Parent is now a tracker (status → pending); the loop works the slices, not it.`);
  return 0;
}

/** Close a split parent once every child is closed. Called after a child ships,
 *  because a tracker whose work is all done and which stays open is a wish the
 *  board keeps showing to a filer who already got what they asked for. */
async function closeParentIfDone(child: Wish): Promise<void> {
  if (typeof child.parentId !== "number") return;
  const all = (await listAllDbWishes()) ?? [];
  const siblings = childrenOf(all, child.parentId);
  const unfinished = siblings.filter(queueIsOpen);
  if (unfinished.length) {
    console.log(`  parent:  #${child.parentId} still waiting on ${unfinished.map((s) => `#${s.id}`).join(", ")}`);
    return;
  }

  await updateDbWish(
    child.scope,
    child.parentId,
    (cur: Wish) => ({ ...cur, status: "done" as const, needsApproval: false, closedAt: cur.closedAt ?? new Date().toISOString() }),
    {
      kind: "update",
      at: new Date().toISOString(),
      body: `Every slice is closed (${siblings.map((s) => `#${s.id}`).join(", ")}), so this tracker closes too.`,
    },
  );
  console.log(`  parent:  #${child.parentId} closed — every slice is done`);
}

// ── claim ────────────────────────────────────────────────────────────────────

/** The same identity shape the worker protocol uses, so the lease a `--claim`
 *  takes is one a later `pnpm worker next` on this machine can re-enter. */
function workerIdentity(_runId: string | null): string {
  const explicit = process.env.WORKER_ID?.trim();
  if (explicit) return explicit;
  return `${userInfo().username}@${hostname()}`.toLowerCase().replace(/[^a-z0-9@.-]/g, "-");
}

async function claim(id: number, runId: string | null): Promise<number> {
  const w = await loadWish(id);
  if (!OPEN(w)) return fail(`Wish #${id} is already ${w.status}. Nothing to claim.`);
  if (w.needsApproval) return fail(`Wish #${id} is waiting on approval. The loop does not build an unapproved wish.`);

  // The SAME atomic claim the worker protocol uses — a conditional UPDATE that
  // takes the lease, so two slots claiming at once get one winner decided by
  // the database. This function used to read-then-write, which is exactly the
  // race that let two runs build the same wish on two branches.
  const holder = workerIdentity(runId);
  const res = await claimWish(w.scope, id, holder);
  if (!res.ok) {
    return fail(
      res.reason === "taken"
        ? `Wish #${id} is already claimed by another run — pick a different wish.`
        : `Wish #${id} is not claimable (${res.reason}).`,
    );
  }

  const by = runId ? `run \`${runId}\`` : "the build loop";
  const updated = await updateDbWish(
    w.scope,
    id,
    (cur: Wish) => cur, // the claim already moved the stage; this appends the note
    { kind: "update", body: `Picked up by ${by}. Stage → Building.`, at: new Date().toISOString() },
  );
  if (!updated) return fail(`Could not annotate #${id}: ${wishStoreError() ?? "the write was rejected."}`);

  const branch = startBranch(id);

  const dive = sectionDive(updated);
  console.log(`Claimed #${id} — ${updated.title}`);
  console.log(`  branch:  ${branch}`);
  console.log(`  stage:   ${stageLabel(w.status)} → Building`);
  if (dive) {
    console.log(`  route:   researcher · depth ladder`);
    console.log(`  gate:    ${dive.entity} clears its next rung — pnpm research:audit`);
  }
  console.log(`  ${updated.issueUrl}`);
  // Printed at the moment it becomes relevant — when a run takes the wish on —
  // rather than left in a doctrine file nobody rereads mid-run.
  console.log(`\n${SPLIT_DOCTRINE}\n`);
  return 0;
}

/**
 * Put the run on its own branch.
 *
 * A wish is untrusted text and the loop acts on it with repository write, so
 * the containment is structural: the work lands on a branch, a human reads the
 * diff, a human merges. `.githooks/pre-push` refuses the shortcut.
 *
 * Doing it HERE rather than asking the loop to remember means the default path
 * is the safe one. A rule that depends on an agent recalling it mid-run is a
 * rule that holds until the first long run.
 *
 * Failure is reported, not fatal: a detached HEAD or a dirty tree is a reason
 * for a human to look, not a reason to lose a claim that already succeeded.
 */
function startBranch(id: number): string {
  const name = `wish/${id}`;
  const git = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    const current = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (current === name) return `${name} (already on it)`;
    // Reuse the branch if a previous run made it; otherwise cut a new one.
    const exists = (() => {
      try {
        git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
        return true;
      } catch {
        return false;
      }
    })();
    git(exists ? ["switch", name] : ["switch", "-c", name]);
    return exists ? `${name} (resumed)` : name;
  } catch (e) {
    const why = (e as Error).message.split("\n").find((l) => l.trim()) ?? "unknown";
    return `NOT CREATED — ${why.trim()}. Make one before you push: git switch -c ${name}`;
  }
}

// ── ship ─────────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

/** The run's cost, as the run recorded it — never as this script guessed it. Both halves
 *  of the block must be numbers: a half-filled `tokens` is not a measurement, so it reads
 *  as none. Same rule as `readTokens` in app/_platform/wishes/runs.ts, which prices the
 *  same block for the wish's receipt page; if you loosen one, loosen both. */
/** What a run recorded, or null if it recorded nothing usable. Half a
 *  measurement is not a measurement — a missing `out` makes the whole thing
 *  unreportable rather than an optimistic zero. */
function runTokens(runId: string): { in: number; out: number } | null {
  let log: Record<string, unknown>;
  try {
    log = JSON.parse(readFileSync(join(ROOT, "cronjobs", "logs", `${runId}.json`), "utf8"));
  } catch {
    return null;
  }
  const t = log.tokens as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object") return null;
  const i = num(t.in) ?? num(t.input) ?? num(t.input_tokens);
  const o = num(t.out) ?? num(t.output) ?? num(t.output_tokens);
  return i === null || o === null ? null : { in: i, out: o };
}

function runCost(runId: string): string {
  const t = runTokens(runId);
  if (!t) return "not recorded";
  const n = (x: number) => x.toLocaleString("en-US");
  return `${n(t.in + t.out)} tokens (${n(t.in)} in · ${n(t.out)} out)`;
}

/**
 * Charge the run to whoever filed the wish.
 *
 * Over HTTP because the ledger lives in the identity database, which is
 * `server-only` and holds credentials this process does not have. The wish
 * number is what is sent — never an account — so this cannot be used to bill
 * someone who did not ask for the work.
 *
 * A failure here NEVER fails the ship. Metering is bookkeeping; the wish was
 * built either way, and refusing to close it because a ledger was unreachable
 * would be the tail wagging the dog. It says so out loud instead, so an
 * operator can reconcile rather than discover a silent gap later.
 */
async function reportUsage(wishId: number, scope: string, runId: string): Promise<string> {
  const base = process.env.PLATFORM_URL?.replace(/\/$/, "");
  const token = process.env.WISH_WORKER_TOKEN;
  if (!base || !token) return "not charged (set PLATFORM_URL and WISH_WORKER_TOKEN to record usage)";

  // Reported even when the log has no counts: the endpoint records the
  // FULFILMENT before it looks at the tokens, and skipping the call would make
  // "no token report" the way to build outside the daily guarantee.
  const tokens = runTokens(runId) ?? { in: 0, out: 0 };

  try {
    const res = await fetch(`${base}/api/internal/usage`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": token },
      body: JSON.stringify({
        wishId,
        scope,
        workerId: workerIdentity(runId),
        inputTokens: tokens.in,
        outputTokens: tokens.out,
        // Same key shape as the worker protocol: a retry of THIS ship records
        // once; a genuinely new run carries a new run id and is recorded.
        idempotencyKey: `${wishId}:${runId}`,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { recorded?: boolean; why?: string; error?: string };
    if (!res.ok) return `NOT charged — ${res.status} ${body.error ?? "the ledger refused"}`;
    return body.recorded ? "charged to the filer" : `not charged (${body.why ?? "no filer on record"})`;
  } catch (err) {
    return `NOT charged — ${(err as Error).message}`;
  }
}

async function ship(id: number, runId: string): Promise<number> {
  const w = await loadWish(id);
  if (w.status === "done") return fail(`Wish #${id} is already shipped. Two runs think they built it — reconcile before closing.`);

  const cost = runCost(runId);
  const updated = await updateDbWish(
    w.scope,
    id,
    (cur: Wish) => ({ ...cur, status: "done" as const, needsApproval: false, closedAt: cur.closedAt ?? new Date().toISOString() }),
    {
      kind: "update",
      body: `Shipped by run \`${runId}\` — see \`cronjobs/logs/${runId}.json\`.\n\nWhat that run cost: ${cost}.`,
      at: new Date().toISOString(),
    },
  );
  if (!updated) return fail(`Could not ship #${id}: ${wishStoreError() ?? "the write was rejected."}`);

  console.log(`Shipped #${id} — ${updated.title}`);
  console.log(`  stage:   ${stageLabel(w.status)} → Shipped`);
  console.log(`  run:     ${runId}`);
  console.log(`  cost:    ${cost}`);
  console.log(`  usage:   ${await reportUsage(id, w.scope, runId)}`);
  await closeParentIfDone(updated);
  console.log(`  ${updated.issueUrl}`);
  console.log(`\n  Open a pull request — a wish's work is not merged by the run that did it:`);
  console.log(`    git push -u origin wish/${id} && gh pr create --fill`);
  console.log(`\n  Then put ${id} in that run log's "wishes" array — it is what points the`);
  console.log(`  wish's receipt back at the run. The comment alone only links one way.`);
  return 0;
}

// ── cli ──────────────────────────────────────────────────────────────────────

function fail(msg: string): number {
  console.error(msg);
  return 1;
}

const USAGE = `pnpm wishes [--scope <slug>]
       pnpm wishes --claim <n>
       pnpm wishes --split <n> --into "..." --into "..."
       pnpm wishes --ship <n> --run <run-id>`;

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

/** Repeatable flag — `--into "a" --into "b"`. `flag` returns the first match
 *  only, which would silently drop every slice after the first. */
function flagAll(argv: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith("--")) out.push(argv[i + 1]);
  }
  return out;
}

async function main(): Promise<number> {
  loadEnvLocal();
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }

  if (!wishDbConfigured()) {
    console.log(
      "Wishes are not persisted: no PRODUCT_DB_<SCOPE>_URL is set, so the wishlist is in-memory in the web app and this process cannot see it. There is no backlog to read. Work the roadmap and the researched opportunities instead.",
    );
    return 0;
  }

  const splitId = flag(argv, "split");
  if (splitId) {
    if (!/^\d+$/.test(splitId)) return fail(`--split wants a wish number. ${USAGE}`);
    return split(Number(splitId), flagAll(argv, "into"));
  }

  const claimId = flag(argv, "claim");
  const shipId = flag(argv, "ship");
  const runId = flag(argv, "run");

  if (claimId) {
    if (!/^\d+$/.test(claimId)) return fail(`--claim wants a wish number. ${USAGE}`);
    return claim(Number(claimId), runId);
  }

  if (shipId) {
    if (!/^\d+$/.test(shipId)) return fail(`--ship wants a wish number. ${USAGE}`);
    if (!runId) return fail("--ship needs --run <run-id>, so the wish links to the run that fulfilled it.");
    return ship(Number(shipId), runId);
  }

  const wishes = await listAllDbWishes();
  if (!wishes) return fail(`Could not read wishes: ${wishStoreError() ?? "no product database is configured."}`);
  list(wishes, flag(argv, "scope"));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
