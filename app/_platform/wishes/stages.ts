/**
 * The stage vocabulary — the steps a wish moves through.
 *
 * Its own module, with NO imports, on purpose. `WishBoard` is a client
 * component and needs the labels; `scripts/wishes.ts` runs under tsx and needs
 * the same list. Both used to reach it through ../wishes, which also pulls in
 * the database store — so a label lookup dragged `@libsql/client` and a
 * `server-only` guard into a browser bundle and into a CLI that has neither.
 *
 * Nothing here touches storage, so everything can import it.
 */

/**
 * The stages a wish moves through.
 *
 * A GitHub issue is open or closed, and that was the whole vocabulary here: a
 * wish said `new` until a run said `done`, with nothing in between that a
 * person could read. Two moments were missing and both matter:
 *
 *   - `ready` — accepted AND queued, as against accepted-someday. Without it,
 *     `backlog` and "the loop may take this" were the same word.
 *   - `review` — built but not yet through the critic gate. That gate is real
 *     (critic-voice and critic-visual can block a push), so a wish genuinely
 *     lives there for a while, and it used to be invisible: a wish jumped from
 *     building straight to done and the review was a thing that happened to
 *     nobody's knowledge.
 *
 * Borrowed from Linear rather than invented: each stage belongs to a CATEGORY,
 * and the category is what code branches on. That is what lets the list change
 * — add `blocked`, drop `duplicate` — without every caller relearning which
 * strings mean "still owed".
 */
export type WishStatus =
  | "triage"
  | "backlog"
  | "ready"
  | "building"
  | "review"
  | "done"
  | "declined"
  | "duplicate";

/** open = nobody is working it · active = a run has it · closed = finished with.
 *  Branch on this, never on a list of stage strings. */
export type StageCategory = "open" | "active" | "closed";

export const STAGES: { id: WishStatus; category: StageCategory; label: string; blurb: string }[] = [
  { id: "triage",    category: "open",   label: "Triage",     blurb: "Filed. Nobody has looked at it yet." },
  { id: "backlog",   category: "open",   label: "Backlog",    blurb: "Accepted, but not queued for the loop." },
  { id: "ready",     category: "open",   label: "Ready",      blurb: "Queued — the loop may pick this up." },
  { id: "building",  category: "active", label: "Building",   blurb: "A run has claimed it and is working." },
  { id: "review",    category: "active", label: "In review",  blurb: "Built. Waiting on the critic gate or on you." },
  { id: "done",      category: "closed", label: "Shipped",    blurb: "Built, reviewed, and live." },
  { id: "declined",  category: "closed", label: "Declined",   blurb: "Not going to be built." },
  { id: "duplicate", category: "closed", label: "Duplicate",  blurb: "Already asked for somewhere else." },
];

export const STAGE_IDS = STAGES.map((s) => s.id);
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));

export function stageCategory(s: WishStatus): StageCategory {
  return STAGE_BY_ID.get(s)?.category ?? "open";
}
export function stageLabel(s: WishStatus): string {
  return STAGE_BY_ID.get(s)?.label ?? s;
}
/** Closed means finished with, whether or not it was built. `done` and
 *  `declined` are both closed and are not the same outcome — anything that
 *  needs to tell them apart must ask for the stage, not for this. */
export function isClosed(s: WishStatus): boolean {
  return stageCategory(s) === "closed";
}

/**
 * Stages this one may move to next, for the admin dropdown.
 *
 * Not enforcement — an admin can still set anything through the API, and should
 * be able to; a workflow that refuses to let a person correct it is a workflow
 * people route around. This only stops the dropdown offering `done` on a wish
 * nothing has built, which is how a board starts lying.
 */
export function nextStages(s: WishStatus): WishStatus[] {
  switch (s) {
    case "triage":   return ["backlog", "ready", "declined", "duplicate"];
    case "backlog":  return ["ready", "declined", "duplicate"];
    case "ready":    return ["building", "backlog", "declined", "duplicate"];
    case "building": return ["review", "ready", "declined"];
    case "review":   return ["done", "building", "declined"];
    default:         return ["ready", "backlog"]; // reopening a closed wish
  }
}

/**
 * Read a stage written by an older version of this app.
 *
 * The five-value vocabulary is still on every wish filed before now, and on
 * every GitHub issue the importer reads. Mapping on read rather than migrating
 * in place means a half-imported database is still coherent, and an issue
 * somebody edits by hand on github.com still lands somewhere sensible.
 */
const LEGACY_STAGE: Record<string, WishStatus> = {
  new: "triage",
  pending: "backlog",
  "in-progress": "building",
  done: "done",
  wontfix: "declined",
};

export function readStage(raw: string | null | undefined, fallback: WishStatus = "triage"): WishStatus {
  if (!raw) return fallback;
  if (STAGE_BY_ID.has(raw as WishStatus)) return raw as WishStatus;
  return LEGACY_STAGE[raw] ?? fallback;
}
