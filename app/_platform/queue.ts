/**
 * The wish queue — what is workable, what is a tracker, how fast wishes may arrive.
 *
 * WHAT USED TO BE HERE
 * Two queues: one on the deployment's own capacity, one that ran on an API key
 * the user supplied. The second is gone. It was never wired to a runner, so it
 * took a real credential in exchange for nothing, and it split every question
 * in this file in two for a distinction users never asked for. Capacity is now
 * one pool; an account that wants more of it tops up its token balance
 * (`app/lib/usage.ts`) rather than bringing its own key.
 *
 * How that pool is actually served is the operator's business, is not the same
 * for every deployment, and is described nowhere in this repository — not in a
 * comment, not in an error string, not on a page.
 *
 * WHAT THIS MODULE IS NOT
 * There is no scheduler here, and there should not be one until something
 * other than a person is choosing the order. The loop reads the board and
 * picks; the board's sort (priority, then votes, then newest) is the whole
 * ordering policy. An earlier version of this file carried a round-robin
 * picker and a per-account turn ledger, which described a worker service this
 * project does not have.
 *
 * WHAT PAYING DOES NOT CHANGE
 * Every gate is blind to the balance. A wish from an account that has paid goes
 * through the same product-scope guardrail, the same pre-commit critics, and
 * the same content validators, and is refused for the same reasons. Paying buys
 * throughput; it does not buy the right to skip a review. Anything that made
 * paid work cheaper to police would have turned metering into a security
 * control, which it is not — a wish is untrusted text handed to an agent with
 * shell access either way.
 */

// Pure: no database, no `server-only`. The CLI and the web app read the same
// definitions, and a module that could only run inside Next would have forced
// the two to be written twice and drift.
// Stage helpers come from the leaf module, not ../wishes: this file is read by
// the CLI too, and ../wishes pulls in the database store.
import { isClosed, stageCategory } from "./wishes/stages";
import type { Wish } from "./wishes";

/**
 * Anti-flood only — NOT a tier limit.
 *
 * The tier limit is the usage meter (`app/lib/usage.ts`), which counts what was
 * actually built. This counts how fast wishes arrive, which is a different
 * problem: a script filing faster than a person could, costing storage and
 * reviewer attention before anything is built at all. Set high enough that a
 * real person filing a real backlog never meets it.
 */
/**
 * The most wishes an account may have OPEN at once.
 *
 * Beside the flood rate rather than with the tiers, because it is the same kind
 * of thing: a structural bound on what one account can cost everybody else. It
 * shapes no tier and buys nothing — a hundred SHIPPED wishes is a good customer,
 * a hundred OPEN ones is a board nobody else can read.
 */
export const WISHES_PENDING_MAX = Number(process.env.WISHES_PENDING_MAX) || 100;

export const WISH_FILE_RATE = 20;
export const WISH_FILE_WINDOW_MS = 60 * 60 * 1000;

/** An open wish is one the loop still owes someone — anything not in a closed
 *  stage. Asks the stage table rather than listing stage names, so adding a
 *  stage later does not silently make it count as open here. */
export const isOpen = (w: Wish): boolean => !isClosed(w.status);

// ── splitting a wish that is too big for one sitting ───────────────────────

/**
 * Guidance the loop follows when a claimed wish turns out to be too big.
 *
 * This is a working practice, not a fairness mechanism. A wish that occupies
 * the worker all day is bad for three reasons that have nothing to do with queue
 * order: the filer sees nothing until it is all done, the diff arrives too
 * large for the critics to review usefully, and an interruption loses the whole
 * run instead of one slice.
 */
export const SPLIT_DOCTRINE = `If a claimed wish is too big to finish and review in one sitting, do not run over.
Split the remainder with \`pnpm wishes --split <n> --into "..."\`, ship or close what
you did finish, and let the next slice be its own run.

Split on a seam a reader would recognise — one surface, one migration step, one
entity — never into "part 1 / part 2". A child that cannot be understood without
its siblings is not a smaller wish, it is the same wish in pieces.`;

/** Ids of wishes that have been split. A parent is a tracker, not work: its
 *  children carry the actual tasks, so the loop should never claim a parent. */
export function parentIds(all: Wish[]): Set<number> {
  const parents = new Set<number>();
  for (const w of all) if (typeof w.parentId === "number") parents.add(w.parentId);
  return parents;
}

/** The children of a split wish, in filing order. */
export function childrenOf(all: Wish[], parentId: number): Wish[] {
  return all.filter((w) => w.parentId === parentId).sort((a, b) => a.id - b.id);
}

/**
 * What the loop could actually pick up: open, not already claimed by another
 * run, not awaiting approval, and not a split parent.
 *
 * A filter, not an order. The loop still chooses which of these to work — this
 * only keeps trackers and in-flight wishes out of the list it chooses from.
 */
export function workable(all: Wish[]): Wish[] {
  const parents = parentIds(all);
  const open = new Set(all.filter((w) => !isClosed(w.status)).map((w) => w.id));
  return all.filter(
    // `open` category only: `building` and `review` mean a run already has it.
    (w) => stageCategory(w.status) === "open" && w.status !== "triage" && !parents.has(w.id)
      // Blocked while its blocker is still open. Derived on every read, so the
      // wish frees itself the moment the blocker closes — there is no unblock
      // step for anyone to forget. A blocker that does not exist here (wrong
      // scope, deleted) does not block: an unresolvable id would strand the
      // wish for ever, and the board would show no reason.
      && !(typeof w.blockedBy === "number" && open.has(w.blockedBy)),
  );
}

/** Is this wish waiting on another? The board asks so it can say so; the answer
 *  is computed, never stored. */
export function blockerOf(all: Wish[], w: Wish): Wish | null {
  if (typeof w.blockedBy !== "number") return null;
  const blocker = all.find((x) => x.id === w.blockedBy);
  return blocker && !isClosed(blocker.status) ? blocker : null;
}
