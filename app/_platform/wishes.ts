/**
 * Wishes — the wishlist store.
 *
 * A wish is scoped to a product slug (or "site"). Users submit wishes (via the
 * form, Design Mode, or by splitting a transcript); each can carry media
 * attachments, be prioritized, require approval, gather an activity thread, and
 * be followed up after it ships.
 *
 * Where a wish lives:
 *
 *   PRODUCT_DB_<SCOPE>_URL set → rows in that product's own database, beside its
 *     research corpus. `site` is a product like any other. See ./wishes/db.ts.
 *
 *   Not set → the array below, which resets on the next cold start. x has to run
 *     with no secrets at all, so this is the floor. Every surface that renders a
 *     wish says which of the two it is looking at: an ephemeral wishlist that
 *     pretends to be durable is worse than no wishlist.
 *
 * The two paths return the same `Wish`, so the API routes and the UI never learn
 * which one is live.
 *
 * WISHES USED TO BE GITHUB ISSUES. The repo is public, so every wish for every
 * product was world-readable and stayed that way after deletion here — while a
 * wish is business data that says what a customer wants and what is missing.
 * One repo is also one permission boundary, where a per-product database has
 * its own scoped token and cannot read a sibling's. The issue store and its
 * importer are gone; the repository they read held no wishes.
 */
import * as wdb from "./wishes/db";
import { runsForWish, type WishRun } from "./wishes/runs";

// The stage vocabulary lives in its own import-free module so that client
// components and the CLI can read it without pulling in the store. Re-exported
// here because ../wishes is the name every existing caller already knows.
import { isClosed, stageLabel, type WishStatus } from "./wishes/stages";

export {
  STAGES,
  STAGE_IDS,
  stageCategory,
  stageLabel,
  isClosed,
  nextStages,
  readStage,
} from "./wishes/stages";
export type { WishStatus, StageCategory } from "./wishes/stages";

export type Role = "PM" | "UX" | "Eng";
export type WishSource = "design-mode" | "form" | "split" | "roadmap";
export type Media = { name: string; type: string; url: string };

/** A rank, not a flag. `priority: true` could only ever say "this one matters",
 *  which is what every filer thinks of their own wish; it sorted nothing. p0–p2
 *  is an ordering an admin can defend, and it rides on the issue as a label. */
export type Priority = "p0" | "p1" | "p2" | null;
export const PRIORITIES = ["p0", "p1", "p2"] as const;
export const PRIORITY_LABEL: Record<"p0" | "p1" | "p2", string> = {
  p0: "P0 · now",
  p1: "P1 · next",
  p2: "P2 · someday",
};

/** `followup` is its own kind, not a note that happens to start with the word.
 *  It is the one comment that reopens a closed wish, so it has to be legible as
 *  itself in the thread, on the timeline, and on github.com. */
export type WishCommentKind = "update" | "note" | "followup";
export type WishComment = { kind: WishCommentKind; body: string; at: string; author?: string };

export type Wish = {
  id: number;
  scope: string;
  title: string;
  body: string;
  status: WishStatus;
  role: Role;
  nickname: string;
  source: WishSource;
  votes: number;
  priority: Priority;
  needsApproval: boolean;
  followups: number;
  media: Media[];
  comments: WishComment[];
  createdAt: string;
  closedAt: string | null;
  /**
   * Set on a child of a split wish. A wish too big to finish in one turn is
   * broken into children so the worker can stop between them; the parent then
   * stops being work and becomes a tracker, which `workable()` skips
   * (`parentIds` in ./queue).
   *
   * Children inherit the parent's filer, so a split never buys extra queue
   * share — see the splitting note in ./queue.
   */
  parentId?: number;
  /**
   * Another wish that must close before this one can be worked.
   *
   * A FIELD, not a stage. As a stage it would have to be un-set by hand when
   * the blocker closed — to whichever stage the wish had been in before, which
   * nothing records — and a wish whose blocker shipped weeks ago would sit
   * blocked until somebody noticed. As a field, `workable()` simply skips it
   * while the blocker is open, and the wish becomes workable again the moment
   * the blocker closes. Nothing to remember to undo.
   *
   * It still READS as a status on the board ("blocked by #123"); that display
   * is derived, the same way `needsApproval` is derived from `triage`.
   */
  blockedBy?: number;
  /**
   * The product a SITE wish was split out of.
   *
   * Visibility, not bookkeeping: a platform change that came out of someone's
   * product wish is that product's business, so its readers get to see it. A
   * site wish with no origin is internal platform work and is not theirs.
   */
  originScope?: string;
  /**
   * A site wish a site admin has chosen to show publicly.
   *
   * Default false, and deliberately not a stage: publishing is a decision about
   * an audience, not a step in the work. It exists so the site board still has
   * something on it after site wishes stopped being world-readable — the door
   * is shut, the window is a choice.
   */
  publicWish?: boolean;
  /** Set only when the wish is a GitHub issue. The link the admin page offers. */
  issueUrl?: string;
};

// ── approval ──────────────────────────────────────────────────────────────
/**
 * Whether a wish waits for a person is decided by the FILER'S PERMISSION, and
 * that decision is made by the caller — see `app/lib/approval.ts` for the rule
 * and why it replaced the one that read the wording of a request.
 *
 * It is a parameter rather than something computed here because answering it
 * requires the identity database, and this module is read by the CLI too. A
 * caller that does not say defaults to NEEDING approval: the safe answer when
 * nobody has established who is asking.
 */

// ── governance (content firewall for product wishes) ──────────────────────

/**
 * What to do with a product wish that reaches outside its product.
 *
 * There are two ways to reach outside and they deserve different answers:
 *
 *   SPLIT — the ask needs a platform change. The product half is real work on
 *   a real board, and the platform half is real work on the site board. So file
 *   both and make the product half wait on the platform half, rather than
 *   refusing and making the filer type it twice. Splitting is cheap to get
 *   wrong: a bad split costs a site admin one click to decline. Refusing is
 *   expensive to get wrong — it turns a legitimate ask away, and the person
 *   often does not come back.
 *
 *   REFUSE — the ask names a DIFFERENT product. That half cannot be split off,
 *   because it belongs on a board the filer may not even be allowed to read,
 *   and filing into it on their behalf would leak that the board exists and put
 *   words in their mouth there. The wish is real; it is just on the wrong page.
 *
 * The detector is a word list, and word lists are wrong sometimes — that is the
 * whole reason `split` replaced a refusal here rather than joining it.
 */
export type Governance =
  | { verdict: "ok" }
  | { verdict: "refuse"; reason: string }
  | { verdict: "split"; reason: string };

const PLATFORM_FLAGS = ["_platform", "app/lib", ".githooks", "the platform spine", "all products", "every product"];

export function governProductWish(scope: string, title: string, body: string, otherSlugs: string[]): Governance {
  if (scope === "site") return { verdict: "ok" };
  const text = `${title}\n${body}`.toLowerCase();

  for (const slug of otherSlugs) {
    if (slug === scope) continue;
    if (new RegExp(`\\b${slug}\\b`, "i").test(text)) {
      return { verdict: "refuse", reason: `A ${scope} wish can't target another product ("${slug}"). File it on that product's board.` };
    }
  }
  for (const flag of PLATFORM_FLAGS) {
    if (text.includes(flag)) {
      return { verdict: "split", reason: `it mentions "${flag}", which lives in the platform rather than in this product` };
    }
  }
  return { verdict: "ok" };
}

// ── where wishes live ──────────────────────────────────────────────────────

/** What the wishlist is actually reading and writing right now. Rendered, not
 *  hidden: `persisted: false` is the thing the reader most needs to know. */
export type WishStoreInfo = {
  mode: "db" | "memory";
  persisted: boolean;
  /** Which product databases answered. Empty means none are provisioned. */
  scopes: string[];
  /** The database's own message when a scope failed. Never carries a credential. */
  error: string | null;
};
export function wishStore(): WishStoreInfo {
  const scopes = wdb.configuredScopes();
  return {
    mode: scopes.length ? "db" : "memory",
    persisted: scopes.length > 0,
    scopes,
    error: scopes.length ? wdb.wishStoreError() : null,
  };
}

// ── the in-memory floor ────────────────────────────────────────────────────
// Starts empty — wishes come from real users (the form, Design Mode, roadmap).
// Only read when no product database is provisioned. x has to run with zero
// secrets, and a wishlist that crashes without one is worse than an honest
// ephemeral one that says so on every surface that renders it.
let seq = 100;
const memory: Wish[] = [];

const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();

/** Unranked sorts below p2: an admin who has not ranked a wish has not said it is
 *  less urgent than a p2, but the board has to put it somewhere, and below the
 *  things someone did rank is the honest place. */
const PRIORITY_RANK: Record<string, number> = { p0: 0, p1: 1, p2: 2 };
const priorityRank = (p: Priority) => (p ? PRIORITY_RANK[p] : 3);

const rank = (a: Wish, b: Wish) =>
  priorityRank(a.priority) - priorityRank(b.priority) || b.votes - a.votes || b.id - a.id;

// ── read ───────────────────────────────────────────────────────────────────

/** Every wish, every product. The site-wide wishlist is the only caller that
 *  wants this; a product page asks for its own scope, which is one database. */
export async function listAllWishes(): Promise<Wish[]> {
  const rows = await wdb.listAllDbWishes();
  return [...(rows ?? memory)].sort(rank);
}

/** One product's wishes — one database, not a filter over all of them. */
export async function listWishes(scope: string): Promise<Wish[]> {
  const rows = await wdb.listScopeWishes(scope);
  if (rows) return rows.sort(rank);
  return memory.filter((w) => w.scope === scope).sort(rank);
}

/**
 * A wish by id.
 *
 * Ids are per-product now, so a bare number can match in more than one
 * database. Pass `scope` wherever the caller knows it; without one this
 * searches in `wishScopes()` order and takes the first hit.
 */
export async function getWish(id: number, scope?: string): Promise<Wish | null> {
  if (wdb.wishDbConfigured()) {
    const w = scope ? await wdb.getDbWish(scope, id) : await wdb.findDbWish(id);
    if (w) return w;
    if (scope) return null;
  }
  return memory.find((x) => x.id === id) ?? null;
}

export async function listComments(id: number): Promise<WishComment[]> {
  return (await getWish(id))?.comments ?? [];
}

// ── write ──────────────────────────────────────────────────────────────────

export async function addWish(input: {
  scope: string; title: string; body?: string; role?: Role; nickname?: string;
  source?: WishSource; media?: Media[]; parentId?: number; blockedBy?: number; originScope?: string;
  /** Decided by the caller from the filer's role. Omitted means "wait" — a
   *  caller that never established who is asking has not earned an auto-yes. */
  needsApproval?: boolean;
}): Promise<Wish> {
  const body = (input.body ?? "").trim();
  const needsApproval = input.needsApproval ?? true;
  const draft: Omit<Wish, "id" | "issueUrl"> = {
    scope: input.scope,
    title: input.title.trim().slice(0, 160),
    body: body.slice(0, 4000),
    // Triage IS the pending-approval stage — there is no second flag to keep in
    // step with it. A wish nobody has to review is ready for the loop the moment
    // it is filed.
    status: needsApproval ? "triage" : "ready",
    role: input.role ?? "PM",
    nickname: input.nickname ?? "guest",
    source: input.source ?? "form",
    votes: 1,
    priority: null,
    needsApproval,
    followups: 0,
    media: (input.media ?? []).slice(0, 4),
    comments: [],
    createdAt: today(),
    closedAt: null,
    ...(input.parentId ? { parentId: input.parentId } : {}),
    ...(input.blockedBy ? { blockedBy: input.blockedBy } : {}),
    ...(input.originScope ? { originScope: input.originScope } : {}),
  };

  const stored = await wdb.createDbWish(draft);
  if (stored) return stored;

  // The product's database is unreachable, or none is provisioned. Losing the
  // wish outright is the one outcome worth avoiding, so keep it in memory and
  // let the store banner say the wishlist is not persisted.
  const w: Wish = { ...draft, id: seq++ };
  memory.push(w);
  return w;
}

/**
 * Read-modify-write one wish, wherever it lives.
 *
 * `scope` is optional because most callers reach a wish through a route that
 * only ever carried its number. Ids are per-product now, so without a scope
 * this has to locate the wish first — pass one wherever it is known.
 */
async function mutate(id: number, patch: (w: Wish) => Wish, comment?: WishComment, scope?: string): Promise<Wish | null> {
  if (wdb.wishDbConfigured()) {
    const where = scope ?? (await wdb.findDbWish(id))?.scope;
    if (where) {
      const w = await wdb.updateDbWish(where, id, patch, comment);
      if (w) return w;
    }
  }
  const w = memory.find((x) => x.id === id);
  if (!w) return null;
  Object.assign(w, patch({ ...w, comments: [...w.comments] }));
  if (comment) w.comments.push(comment);
  return w;
}

// Every action below that changes what a wish *is* also writes a dated line into
// its thread. That is not bookkeeping for its own sake: the thread is the only
// record the receipt is built from, so an action that changes the wish silently
// is an action the receipt cannot show. Upvoting is the one exception — a vote
// count is already on the card, and a comment per vote would bury the thread.

export function upvote(id: number): Promise<Wish | null> {
  return mutate(id, (w) => ({ ...w, votes: w.votes + 1 }));
}

/**
 * Approve: move the wish OUT of triage.
 *
 * `needsApproval` is not a stored column — the store derives it from the stage
 * (`triage` is what pending means, `wishes/db.ts`). So clearing the flag alone
 * wrote nothing: the patch lived in the returned object, the row kept its
 * stage, and the next read said pending again. The wish sat in the review queue
 * for ever and the loop, which refuses an unapproved wish, never touched it.
 * Approving looked like it worked and did nothing, which is the worst of the
 * three outcomes.
 *
 * `ready` rather than `backlog`: approving says the loop may pick this up, and
 * that is exactly what `ready` means. Parking it in `backlog` would be a second
 * queue nobody agreed to.
 */
/**
 * Make one wish wait on another.
 *
 * Written after both wishes exist, because the blocker's id is not known until
 * it is created. Nothing un-blocks: `workable()` re-derives the answer from the
 * blocker's stage on every read, so closing the blocker is the whole unblock.
 */
export function blockWish(id: number, blockerId: number, byWhom: string): Promise<Wish | null> {
  return mutate(id, (w) => ({ ...w, blockedBy: blockerId }), {
    kind: "update",
    body: `Waiting on #${blockerId} — the platform change this needs. Nothing builds this until that one closes.`,
    at: nowIso(),
    author: byWhom,
  });
}

/**
 * Show a platform wish publicly, or take it back.
 *
 * The flag only means anything on a site wish — every other scope is already
 * gated by its product — so the route refuses it elsewhere rather than storing
 * a value nothing reads.
 *
 * Publishing is a decision about an audience, not a step in the work, which is
 * why it is a flag and not a stage. A wish can be published while still in
 * triage (worth showing that it was asked) or after it shipped (worth showing
 * what landed), and neither is a different kind of wish.
 */
export function setWishPublic(id: number, isPublic: boolean, byWhom: string): Promise<Wish | null> {
  return mutate(id, (w) => ({ ...w, publicWish: isPublic }), {
    kind: "update",
    body: isPublic
      ? "Published — anyone can see this platform wish now."
      : "Unpublished — visible again only to site admins, its filer, and the product it came from.",
    at: nowIso(),
    author: byWhom,
  });
}

export function approveWish(id: number, byWhom: string): Promise<Wish | null> {
  return mutate(id, (w) => ({ ...w, needsApproval: false, status: "ready" as const }), {
    kind: "update", body: "Approved — released to the build loop.", at: nowIso(), author: byWhom,
  });
}

/** Decline, with the reviewer's reason when they gave one. `declined` is closed
 *  but not shipped, so it never counts toward a delivery record. */
export function rejectWish(id: number, byWhom: string, why?: string): Promise<Wish | null> {
  return mutate(id, (w) => ({ ...w, needsApproval: false, status: "declined" as const, closedAt: nowIso() }), {
    kind: "update",
    body: why ? `Not approved — ${why}` : "Not approved.",
    at: nowIso(),
    author: byWhom,
  });
}

/** Cancel is `declined`, not `done`. Both are closed, and collapsing them would
 *  file "we are not going to" next to the shipped work — which is how a board
 *  starts reporting a delivery record it did not have. */
export function cancelWish(id: number, byWhom: string, reason?: string): Promise<Wish | null> {
  return mutate(id, (w) => ({ ...w, status: "declined", needsApproval: false, closedAt: nowIso() }), {
    kind: "update",
    body: reason?.trim() ? `Cancelled — ${reason.trim()}` : "Cancelled.",
    at: nowIso(),
    author: byWhom,
  });
}

export function prioritizeWish(id: number, priority: Priority, byWhom: string): Promise<Wish | null> {
  return mutate(id, (w) => ({ ...w, priority }), {
    kind: "update",
    body: priority ? `Prioritised ${PRIORITY_LABEL[priority]}.` : "Priority cleared.",
    at: nowIso(),
    author: byWhom,
  });
}

export function modifyWish(id: number, title: string, body: string, byWhom: string): Promise<Wish | null> {
  return mutate(
    id,
    (w) => ({ ...w, title: title.trim().slice(0, 160), body: body.trim().slice(0, 4000) }),
    { kind: "update", body: "Edited by the person who filed it.", at: nowIso(), author: byWhom },
  );
}

/** A follow-up says the wish was closed too early. It reopens it and says why.
 *  Straight to `ready`, not `triage`: it was already accepted once, and making
 *  someone re-triage work they already agreed to is how follow-ups get ignored. */
export function followUpWish(id: number, text: string, byWhom: string): Promise<Wish | null> {
  return mutate(id, (w) => ({ ...w, followups: w.followups + 1, status: "ready", closedAt: null }), {
    kind: "followup", body: text.trim(), at: nowIso(), author: byWhom,
  });
}

/** Walk a wish along the workflow. Closing stamps `closedAt`; reopening clears
 *  it, so "when did this finish" can never outlive the finish. */
export function setWishStatus(id: number, status: WishStatus, byWhom: string): Promise<Wish | null> {
  const closing = isClosed(status);
  return mutate(
    id,
    (w) => ({
      ...w,
      status,
      needsApproval: status === "triage",
      closedAt: closing ? (w.closedAt ?? nowIso()) : null,
    }),
    { kind: "update", body: `Stage → ${stageLabel(status)}.`, at: nowIso(), author: byWhom },
  );
}

/** Answer a wish in its thread. */
export function commentOnWish(id: number, text: string, byWhom: string): Promise<Wish | null> {
  return mutate(id, (w) => w, { kind: "note", body: text.trim().slice(0, 2000), at: nowIso(), author: byWhom });
}

// ── derived ────────────────────────────────────────────────────────────────

/** Shipped-wish counts by builder role — for the viber bar. */
export async function wishStats(scope: string): Promise<{ total: number; open: number; byRole: Record<Role, number> }> {
  const scoped = await listWishes(scope);
  const shipped = scoped.filter((w) => w.status === "done");
  const byRole: Record<Role, number> = { PM: 0, UX: 0, Eng: 0 };
  for (const w of shipped) byRole[w.role]++;
  return { total: shipped.length, open: scoped.filter((w) => !isClosed(w.status)).length, byRole };
}

/** Cumulative shipped-over-time series for a scope. */
export async function wishTimeline(scope: string): Promise<{ total: number; points: { date: string; count: number; cumulative: number }[] }> {
  const done = (await listWishes(scope))
    .filter((w) => w.status === "done" && w.closedAt)
    .sort((a, b) => (a.closedAt! < b.closedAt! ? -1 : 1));
  const byDay = new Map<string, number>();
  for (const w of done) {
    const d = w.closedAt!.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  let cumulative = 0;
  const points = [...byDay.entries()].map(([date, count]) => ({ date, count, cumulative: (cumulative += count) }));
  return { total: done.length, points };
}

// ── the receipt ────────────────────────────────────────────────────────────

/**
 * A wish's whole life, in order: filed → answered → prioritised → worked →
 * shipped or cancelled.
 *
 * Every event here is read back from something durable — the issue's created_at,
 * its comments, its closed_at, and the loop's own run logs. Nothing on this
 * timeline is computed for display. That is the point of it: the previous
 * receipt printed a token count from a hash of the wish title, and a person who
 * cannot see what their click produced has no way to tell that apart from a
 * measurement. So the rule for this surface is that an event appears when it was
 * recorded and is absent when it was not.
 */
export type ReceiptEvent = {
  kind: "filed" | "note" | "update" | "followup" | "worked" | "closed";
  at: string;
  title: string;
  body?: string;
  author?: string;
  /** Set on `worked`: the run that says it did this wish. */
  runId?: string;
};

export type Receipt = {
  events: ReceiptEvent[];
  runs: WishRun[];
  /** Summed over the runs that worked this wish. `null` means no run recorded a
   *  token count — which is the honest answer, and is not the same as zero. */
  tokens: { in: number; out: number } | null;
  /** Why `tokens` is null, in words the reader can act on. */
  tokensNote: string;
};

const WORKED_BY: Record<WishRun["via"], string> = {
  "wishes-field": "The run log lists this wish.",
  "wish-first": "The run log names this wish in its wish-first line.",
};

export async function wishReceipt(w: Wish): Promise<Receipt> {
  const runs = await runsForWish(w.id);

  const events: ReceiptEvent[] = [
    { kind: "filed", at: w.createdAt, title: "Filed", author: w.nickname, body: w.source === "form" ? undefined : `via ${w.source}` },
    ...w.comments.map((c): ReceiptEvent => ({
      kind: c.kind,
      at: c.at,
      title: c.kind === "followup" ? "Followed up — reopened" : c.kind === "update" ? "Update" : "Comment",
      body: c.body,
      author: c.author,
    })),
    ...runs.map((r): ReceiptEvent => ({
      kind: "worked", at: r.at, title: `Worked in run ${r.runId}`, body: WORKED_BY[r.via], runId: r.runId,
    })),
  ];

  if (w.closedAt) {
    events.push({
      kind: "closed",
      at: w.closedAt,
      title: w.status === "done" ? "Shipped" : `Closed — ${stageLabel(w.status).toLowerCase()}`,
    });
  }

  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const metered = runs.filter((r) => r.tokens);
  const tokens = metered.length
    ? metered.reduce((acc, r) => ({ in: acc.in + r.tokens!.in, out: acc.out + r.tokens!.out }), { in: 0, out: 0 })
    : null;

  // Most of a long run's input is cache reads. Printing the total without saying
  // so would read as fresh context, which is the kind of true-but-misleading
  // number this receipt exists to not print.
  const cacheRead = metered.reduce((n, r) => n + (r.tokens?.cacheRead ?? 0), 0);
  const cacheShare = tokens && tokens.in > 0 && cacheRead > 0 ? Math.round((cacheRead / tokens.in) * 100) : 0;

  const tokensNote = tokens
    ? `Measured by ${metered.length} run${metered.length === 1 ? "" : "s"} from the model's own usage records.` +
      (cacheShare > 0 ? ` ${cacheShare}% of the input was cache reads, not fresh context.` : "")
    : runs.length
      ? "The runs that worked this wish recorded no token count."
      : "No run has worked this wish yet.";

  return { events, runs, tokens, tokensNote };
}
