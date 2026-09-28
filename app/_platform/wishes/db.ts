/**
 * Wishes, in each product's own database.
 *
 * NOTE: deliberately NOT `server-only`. The build loop reaches wishes through
 * `scripts/wishes.ts`, a plain tsx process, and `server-only` throws there. The
 * guard it provides — never bundled into a client component — is kept instead
 * by keeping the stage vocabulary in ./stages.ts, which is what the client
 * components actually need; nothing under app/ imports this file from a
 * "use client" module, and adding such an import would ship @libsql/client to
 * the browser.
 *
 * WHY NOT GITHUB ISSUES
 * They were issues in one shared public repo. Two problems, and only the first
 * one is the obvious one:
 *
 *   1. Public. Every wish for every product was world-readable, permanently,
 *      including after it was deleted here. A wish is business data — it says
 *      what a customer wants and what is missing — and it was being published.
 *   2. One repo is one permission boundary. Per-product databases already carry
 *      their own scoped tokens, so `gtm`'s credential physically cannot read
 *      `ai-edu`'s wishes. That is the isolation rule the rest of this platform
 *      is built on, and an issue tracker cannot express it at all.
 *
 * WHERE A WISH LIVES
 * In the database of the product it names. `site` is a product like any other
 * (`gtminions-x-site`), so there is no special case and no shared table that
 * every product can see.
 *
 * IDS STAY GLOBAL, AND COST NOTHING TO MINT
 * Splitting the store across databases did NOT split the id space. Each product
 * owns a block of it and draws at random inside its own block, so `#204213` is
 * one wish everywhere and needs no scope beside it to be a reference — and
 * nothing has to be scanned to prove that. Imported wishes keep their old
 * GitHub number, below every block. See ./ids.ts.
 *
 * FAILURE POSTURE
 * Unreachable product → that product contributes nothing to a list, and the
 * error is reported through `wishStoreError` rather than thrown. One product's
 * dead credential must not blank the site-wide board.
 */

import { createClient, type Client, type Row } from "@libsql/client";

import { cachedProductSlugs, listProducts, productCredentials, registryMode, wishBlocks } from "@/app/lib/registry/core";
import { MINT_ATTEMPTS, mintWishId } from "./ids";

/**
 * How many wishes one product may hold.
 *
 * Turso bills on rows READ far more than on storage, and the cost of a board
 * render is the size of the table — so an unbounded table is an unbounded bill
 * that grows with traffic as well as with data. Capping the table bounds both,
 * by construction, the same way the id blocks bound uniqueness.
 *
 * 2,000 is far past any honest use of a wishlist and far short of a surprise.
 * It is a per-PRODUCT cap, so one busy product cannot spend another's headroom.
 */
/**
 * A refusal, not a failure.
 *
 * `withDb` turns every error into `null` so one unreachable product cannot take
 * the site down — and `addWish` reads that null as "the database is not
 * available" and writes to the in-memory store instead. That is right for an
 * outage and badly wrong for a policy decision: a wish that breaches the cap
 * would be silently accepted into memory, which is the opposite of a cap.
 *
 * So policy refusals get their own type and travel through untouched.
 */
export class WishPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WishPolicyError";
  }
}

const maxWishesPerScope = (): number => {
  const n = Number(process.env.WISHES_MAX_PER_SCOPE);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2_000;
};
import { resolveScopeDb, tursoAutoProvision } from "@/app/lib/turso";
import {
  readStage,
  type Media,
  type Priority,
  type Role,
  type Wish,
  type WishComment,
  type WishCommentKind,
  type WishSource,
  type WishStatus,
} from "../wishes";

// ── which databases exist ──────────────────────────────────────────────────

/** `site` first: the platform's own wishes are the ones a reader is most likely
 *  to be looking at, and a stable order makes a cross-scope list deterministic. */
export function wishScopes(): string[] {
  // The registry is a database; `cachedProductSlugs()` is its last-read list
  // (`primeRegistry()`, or any page render, fills it). A scope an operator named
  // outright with PRODUCT_DB_<SCOPE>_URL counts too, registry or not — that is
  // how a test, or a deployment with no registry, still reaches its wishes.
  const named = Object.keys(process.env)
    .map((k) => /^PRODUCT_DB_([A-Z0-9_]+)_URL$/.exec(k)?.[1])
    .filter((s): s is string => Boolean(s))
    .map((s) => s.toLowerCase().replace(/_/g, "-"))
    .filter((s) => s !== "site");
  return ["site", ...new Set([...cachedProductSlugs(), ...named])];
}

/** Make sure the registry has been read once, so `wishScopes()` is not empty. */
export async function primeRegistry(): Promise<void> {
  await listProducts();
}

const envKey = (scope: string, suffix: string) =>
  `PRODUCT_DB_${scope.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;

/**
 * Scopes this deployment can serve.
 *
 * A named `PRODUCT_DB_<SCOPE>_URL` counts, and so does *every* scope when Turso
 * auto-provisioning is configured — because in that mode a database that does
 * not exist yet is one that will, on first use. Reporting it as unconfigured
 * would make a fresh deploy render "the wishlist is not persisted" on a site
 * where it is about to be.
 */
export function configuredScopes(): string[] {
  if (tursoAutoProvision()) return wishScopes();
  return wishScopes().filter((s) => Boolean(process.env[envKey(s, "URL")]));
}

export function wishDbConfigured(): boolean {
  return configuredScopes().length > 0;
}

const clients = new Map<string, Client>();
const opening = new Map<string, Promise<Client | null>>();

/**
 * The client for a scope, creating its database if that is what it takes.
 *
 * Async now: resolving a scope may mean an API round trip on the first call of
 * a cold instance. Shared in-flight so a burst of requests on that instance
 * provisions once rather than N times.
 */
async function clientFor(scope: string): Promise<Client | null> {
  const existing = clients.get(scope);
  if (existing) return existing;

  const running = opening.get(scope);
  if (running) return running;

  const work = (async () => {
    // The registry knows where a product's database is — a Turso URL on its
    // row, or a file under .local-db/ on a computer. Asking Turso directly
    // (resolveScopeDb) answered null in local mode, so on a fresh install a
    // product's own tables were "unavailable" right after the demo loaded.
    // The test fixture keeps the old path so the in-memory floor stays testable.
    const target = registryMode() === "fixture" ? await resolveScopeDb(scope) : await productCredentials(scope).catch(() => null);
    if (!target) return null;
    const c = createClient({ url: target.url, authToken: target.authToken });
    clients.set(scope, c);
    return c;
  })();

  opening.set(scope, work);
  try {
    return await work;
  } finally {
    opening.delete(scope);
  }
}

// ── errors, surfaced not thrown ────────────────────────────────────────────

const errors = new Map<string, string>();

/** What the store banner reports. Null when every reachable scope answered. */
export function wishStoreError(): string | null {
  if (!errors.size) return null;
  return [...errors].map(([scope, msg]) => `${scope}: ${msg}`).join(" · ");
}

function note(scope: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  errors.set(scope, msg);
  console.error(`[wishes/db] ${scope}:`, msg);
}
const clear = (scope: string) => errors.delete(scope);

// ── schema, applied lazily ─────────────────────────────────────────────────

/**
 * The wish tables, created on first use.
 *
 * `scripts/product-db.ts` owns the canonical DDL and creates these when a
 * product is provisioned or pushed. This is the same statements again so that
 * a deployment whose database predates the wish tables heals itself on the
 * first request instead of 500ing until someone remembers to run a script.
 * Keep the two in step; they are both IF NOT EXISTS, so running both is free.
 */
const DDL = [
  `CREATE TABLE IF NOT EXISTS wishes (
     id INTEGER PRIMARY KEY, scope TEXT NOT NULL, title TEXT NOT NULL,
     body TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT 'triage',
     role TEXT NOT NULL DEFAULT 'PM', nickname TEXT NOT NULL DEFAULT 'guest',
     source TEXT NOT NULL DEFAULT 'form', votes INTEGER NOT NULL DEFAULT 1,
     priority TEXT, parent_id INTEGER, blocked_by INTEGER,
     origin_scope TEXT, public_wish INTEGER NOT NULL DEFAULT 0,
     followups INTEGER NOT NULL DEFAULT 0, media TEXT NOT NULL DEFAULT '[]',
     legacy_issue INTEGER, created_at TEXT NOT NULL, closed_at TEXT,
     claimed_by TEXT, claim_expires_at INTEGER,
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE INDEX IF NOT EXISTS wishes_stage_idx ON wishes (stage)`,
  `CREATE INDEX IF NOT EXISTS wishes_scope_idx ON wishes (scope)`,
  `CREATE INDEX IF NOT EXISTS wishes_parent_idx ON wishes (parent_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wishes_legacy_issue_unique ON wishes (legacy_issue)`,
  `CREATE TABLE IF NOT EXISTS wish_comments (
     id INTEGER PRIMARY KEY AUTOINCREMENT, wish_id INTEGER NOT NULL,
     kind TEXT NOT NULL DEFAULT 'note', body TEXT NOT NULL, author TEXT, at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS wish_comments_wish_idx ON wish_comments (wish_id, at)`,
];

const ready = new Map<string, Promise<void>>();

function migrated(scope: string, db: Client): Promise<void> {
  let p = ready.get(scope);
  if (!p) {
    p = (async () => {
      // One round trip, not one per statement — this runs on every cold
      // instance for every scope, and it used to be most of a board's first
      // load. All statements are IF NOT EXISTS, so the batch is safe; if the
      // batch as a unit fails (it runs transactionally), fall back to one by
      // one so an adopted database degrades to a skipped statement.
      try {
        await db.batch(DDL, "write");
      } catch {
        for (const stmt of DDL) {
          try {
            await db.execute(stmt);
          } catch {
            // Idempotent statement against an odd adopted schema; the first
            // real query gives the honest error if something is truly broken.
          }
        }
      }
    })();
    ready.set(scope, p);
  }
  return p;
}

/** Every call funnels through here so no path can forget the migration or the
 *  error bookkeeping. Returns null when the scope has no credential. */
/** The same connection the wish store uses, for product-owned tables.
 *  Exported for `productData.ts` only — product code goes through that module,
 *  which guards the reserved names. */
export async function withScopeDb<T>(scope: string, fn: (db: Client) => Promise<T>): Promise<T | null> {
  return withDb(scope, fn);
}

async function withDb<T>(scope: string, fn: (db: Client) => Promise<T>): Promise<T | null> {
  const db = await clientFor(scope);
  if (!db) return null;
  try {
    await migrated(scope, db);
    const out = await fn(db);
    clear(scope);
    return out;
  } catch (err) {
    // A failed migration must not be remembered as done, or the process never
    // retries it and every later call fails on a missing table.
    ready.delete(scope);
    // A deliberate refusal is not an outage and must not degrade to one.
    if (err instanceof WishPolicyError) throw err;
    note(scope, err);
    return null;
  }
}

// ── row ⇄ wish ─────────────────────────────────────────────────────────────

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const int = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : Number(v ?? fallback) || fallback);

const ROLES: Role[] = ["PM", "UX", "Eng"];
const SOURCES: WishSource[] = ["design-mode", "form", "split", "roadmap"];
const KINDS: WishCommentKind[] = ["update", "note", "followup"];
const LEVELS: Exclude<Priority, null>[] = ["p0", "p1", "p2"];

/** Hand-edited rows and rows written by an older version both have to render.
 *  Every field falls back to something honest rather than throwing mid-page. */
function toWish(scope: string, row: Row, comments: WishComment[]): Wish {
  const role = str(row.role) as Role;
  const source = str(row.source) as WishSource;
  const priority = str(row.priority) as Priority;
  const parent = row.parent_id === null || row.parent_id === undefined ? undefined : int(row.parent_id);
  const blocked = row.blocked_by === null || row.blocked_by === undefined ? undefined : int(row.blocked_by);
  const origin = row.origin_scope ? String(row.origin_scope) : undefined;
  const isPublic = int(row.public_wish) === 1;

  let media: Media[] = [];
  try {
    const parsed = JSON.parse(str(row.media, "[]")) as unknown;
    if (Array.isArray(parsed)) media = parsed.filter((m): m is Media => !!m && typeof (m as Media).url === "string");
  } catch {
    // Malformed JSON in one row costs that row its attachments, not the page.
  }

  return {
    id: int(row.id),
    scope: str(row.scope, scope),
    title: str(row.title),
    body: str(row.body),
    status: readStage(str(row.stage)),
    role: ROLES.includes(role) ? role : "PM",
    nickname: str(row.nickname, "guest"),
    source: SOURCES.includes(source) ? source : "form",
    votes: int(row.votes, 1),
    priority: LEVELS.includes(priority as Exclude<Priority, null>) ? priority : null,
    needsApproval: readStage(str(row.stage)) === "triage",
    followups: int(row.followups),
    media,
    comments,
    createdAt: str(row.created_at),
    closedAt: row.closed_at === null || row.closed_at === undefined ? null : str(row.closed_at),
    ...(parent ? { parentId: parent } : {}),
    ...(blocked ? { blockedBy: blocked } : {}),
    ...(origin ? { originScope: origin } : {}),
    ...(isPublic ? { publicWish: true } : {}),
  };
}

function toComment(row: Row): WishComment {
  const kind = str(row.kind, "note") as WishCommentKind;
  return {
    kind: KINDS.includes(kind) ? kind : "note",
    body: str(row.body),
    at: str(row.at),
    author: row.author === null || row.author === undefined ? undefined : str(row.author),
  };
}

// ── read ───────────────────────────────────────────────────────────────────

/**
 * One scope's wishes, WITHOUT their threads.
 *
 * This used to fetch every comment in the product as well and stitch them on.
 * Nothing consumed them: the board never reads `.comments`, and every consumer
 * that does — the detail page, the receipt, the comments endpoint — goes
 * through `getDbWish` for a single wish. So on every render of every board it
 * read the entire comment table for nothing, and Turso bills rows read.
 *
 * The wish read is bounded too. The creation cap already keeps the table under
 * `maxWishesPerScope`, but a database that predates the cap should not be able
 * to make one page view read a hundred thousand rows.
 */
export async function listScopeWishes(scope: string): Promise<Wish[] | null> {
  return withDb(scope, async (db) => {
    const rows = await db.execute({
      sql: "SELECT * FROM wishes ORDER BY id DESC LIMIT ?",
      args: [maxWishesPerScope()],
    });
    return rows.rows.map((r) => toWish(scope, r, []));
  });
}

/**
 * Every wish in every product we can reach.
 *
 * Scopes are queried in parallel and a dead one contributes an empty list: the
 * site board showing three products instead of four, with a banner saying which
 * one is unreachable, beats it showing an error page.
 */
export async function listAllDbWishes(): Promise<Wish[] | null> {
  await primeRegistry();
  const scopes = configuredScopes();
  if (!scopes.length) return null;
  const results = await Promise.all(scopes.map((s) => listScopeWishes(s)));
  return results.flatMap((r) => r ?? []);
}

export async function getDbWish(scope: string, id: number): Promise<Wish | null> {
  const out = await withDb(scope, async (db) => {
    const [rows, comments] = await Promise.all([
      db.execute({ sql: "SELECT * FROM wishes WHERE id = ?", args: [id] }),
      db.execute({ sql: "SELECT * FROM wish_comments WHERE wish_id = ? ORDER BY at ASC, id ASC", args: [id] }),
    ]);
    const row = rows.rows[0];
    return row ? toWish(scope, row, comments.rows.map(toComment)) : null;
  });
  return out ?? null;
}

/**
 * Find a wish by id when the caller does not know its scope.
 *
 * Ids are per-product now, so this can match in more than one database. It
 * returns the first hit in `wishScopes()` order and that is a genuine
 * ambiguity, not a resolved one — callers that have the scope should pass it.
 * This exists for the routes that only ever had a number, and for old links.
 */
export async function findDbWish(id: number): Promise<Wish | null> {
  await primeRegistry();
  for (const scope of configuredScopes()) {
    const w = await getDbWish(scope, id);
    if (w) return w;
  }
  return null;
}

// ── write ──────────────────────────────────────────────────────────────────

/**
 * Insert a wish, minting its id.
 *
 * No read before the write. The id space is partitioned per product (./ids.ts),
 * so a cross-product collision is impossible by layout, and a same-product
 * clash is caught by `id INTEGER PRIMARY KEY` on the insert itself. Retrying a
 * rejected insert is strictly cheaper than proving in advance that it will not
 * be rejected — that cost nine round trips per wish and grew with every product.
 */
export async function createDbWish(draft: Omit<Wish, "id" | "issueUrl">): Promise<Wish | null> {
  const blocks = await wishBlocks();
  return withDb(draft.scope, async (db) => {
    // One COUNT before the insert. A row read, against an unbounded table and
    // an unbounded bill — and it is the only place the ceiling can be enforced,
    // because nothing else in the app creates a wish.
    const held = int((await db.execute("SELECT COUNT(*) AS n FROM wishes")).rows[0]?.n);
    if (held >= maxWishesPerScope()) {
      throw new WishPolicyError(
        `"${draft.scope}" already holds ${held} wishes, which is WISHES_MAX_PER_SCOPE ` +
          `(${maxWishesPerScope()}). Close some, or raise the cap deliberately — it exists so a ` +
          "table nobody is watching cannot become a bill nobody expected.",
      );
    }

    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
      const id = mintWishId(draft.scope, blocks);
      try {
        await insertWish(db, id, draft, null);
        return { ...draft, id };
      } catch (err) {
        // A duplicate id is the one error worth retrying — anything else (a
        // dead connection, a missing column) will fail identically on the next
        // draw, so re-throw and let `withDb` report it.
        if (!isDuplicateId(err)) throw err;
      }
    }
    throw new Error(
      `Could not mint a free wish id for "${draft.scope}" in ${MINT_ATTEMPTS} attempts. ` +
        "Its id block is unusually full — widen BLOCK in app/_platform/wishes/ids.ts.",
    );
  });
}

/** SQLite reports a PRIMARY KEY clash as a constraint error naming the column.
 *  Matched on text because libsql surfaces the driver's message rather than a
 *  typed code; the pattern is deliberately narrow so an unrelated constraint
 *  failure is not swallowed as a retryable collision. */
function isDuplicateId(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed:\s*wishes\.id/i.test(msg) || /SQLITE_CONSTRAINT_PRIMARYKEY/i.test(msg);
}

/** The one INSERT, shared by the create path and the importer so the column
 *  list cannot drift between them. */
async function insertWish(
  db: Client,
  id: number,
  draft: Omit<Wish, "id" | "issueUrl">,
  legacyIssue: number | null,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO wishes
            (id, scope, title, body, stage, role, nickname, source, votes, priority,
             parent_id, blocked_by, origin_scope, public_wish, followups, media,
             legacy_issue, created_at, closed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, draft.scope, draft.title, draft.body, draft.status, draft.role, draft.nickname,
      draft.source, draft.votes, draft.priority,
      draft.parentId ?? null, draft.blockedBy ?? null, draft.originScope ?? null,
      draft.publicWish ? 1 : 0, draft.followups, JSON.stringify(draft.media),
      legacyIssue, draft.createdAt, draft.closedAt,
    ],
  });
}

/**
 * Read-modify-write one wish, plus an optional thread entry.
 *
 * Not a transaction, deliberately: libsql over HTTP has no cheap interactive
 * transaction, and the failure this would guard against — two admins editing
 * the same wish in the same second — loses one edit rather than corrupting a
 * row. The comment is written after the update so a failed update never leaves
 * a thread entry describing something that did not happen.
 */
export async function updateDbWish(
  scope: string,
  id: number,
  patch: (w: Wish) => Wish,
  comment?: WishComment,
): Promise<Wish | null> {
  const current = await getDbWish(scope, id);
  if (!current) return null;
  const next = patch({ ...current, comments: [...current.comments] });

  const out = await withDb(scope, async (db) => {
    await db.execute({
      sql: `UPDATE wishes SET title=?, body=?, stage=?, role=?, nickname=?, source=?, votes=?,
                   priority=?, parent_id=?, blocked_by=?, origin_scope=?, public_wish=?,
                   followups=?, media=?, closed_at=?,
                   updated_at=unixepoch()
            WHERE id=?`,
      args: [
        next.title, next.body, next.status, next.role, next.nickname, next.source, next.votes,
        next.priority, next.parentId ?? null, next.blockedBy ?? null,
        next.originScope ?? null, next.publicWish ? 1 : 0, next.followups,
        JSON.stringify(next.media), next.closedAt, id,
      ],
    });
    if (comment) {
      await db.execute({
        sql: "INSERT INTO wish_comments (wish_id, kind, body, author, at) VALUES (?, ?, ?, ?, ?)",
        args: [id, comment.kind, comment.body, comment.author ?? null, comment.at],
      });
    }
    return true;
  });
  if (!out) return null;

  return { ...next, comments: comment ? [...next.comments, comment] : next.comments };
}

// ── import from GitHub ─────────────────────────────────────────────────────

/**
 * Write an imported issue in, keeping its GitHub number in `legacy_issue`.
 *
 * Idempotent on that column, so re-running the importer updates rather than
 * duplicating. Used only by `scripts/import-wishes.ts`; the runtime never
 * writes `legacy_issue`.
 */
export async function upsertImportedWish(
  scope: string,
  issueNumber: number,
  draft: Omit<Wish, "id" | "issueUrl">,
): Promise<{ id: number; created: boolean } | null> {
  return withDb(scope, async (db) => {
    const found = await db.execute({
      sql: "SELECT id FROM wishes WHERE legacy_issue = ?",
      args: [issueNumber],
    });
    const existing = found.rows[0];

    if (existing) {
      const id = int(existing.id);
      await db.execute({
        sql: `UPDATE wishes SET scope=?, title=?, body=?, stage=?, role=?, nickname=?, source=?,
                     votes=?, priority=?, parent_id=?, followups=?, media=?,
                     created_at=?, closed_at=?, updated_at=unixepoch()
              WHERE id=?`,
        args: [
          draft.scope, draft.title, draft.body, draft.status, draft.role, draft.nickname,
          draft.source, draft.votes, draft.priority,
          draft.parentId ?? null, draft.followups, JSON.stringify(draft.media),
          draft.createdAt, draft.closedAt, id,
        ],
      });
      // Replace the thread wholesale — the issue is the source of truth during
      // an import, and appending would double every comment on a second run.
      await db.execute({ sql: "DELETE FROM wish_comments WHERE wish_id = ?", args: [id] });
      await writeComments(db, id, draft.comments);
      return { id, created: false };
    }

    // The imported wish KEEPS its GitHub number as its id. Those numbers came
    // from a single repo, so they are already globally unique, and preserving
    // them means every existing link and every "#22" in a thread still points
    // at the same wish. Generated ids start at WISH_ID_FLOOR (100000), well
    // above any issue number, so the two can never collide.
    await insertWish(db, issueNumber, draft, issueNumber);
    const id = issueNumber;
    await writeComments(db, id, draft.comments);
    return { id, created: true };
  });
}

async function writeComments(db: Client, wishId: number, comments: WishComment[]): Promise<void> {
  for (const c of comments) {
    await db.execute({
      sql: "INSERT INTO wish_comments (wish_id, kind, body, author, at) VALUES (?, ?, ?, ?, ?)",
      args: [wishId, c.kind, c.body, c.author ?? null, c.at],
    });
  }
}

/** Map an imported wish's old GitHub number to its new per-product id, so the
 *  importer can rewrite `parent_id` after every wish exists. */
export async function legacyIdMap(scope: string): Promise<Map<number, number>> {
  const out = await withDb(scope, async (db) => {
    const rows = await db.execute("SELECT id, legacy_issue FROM wishes WHERE legacy_issue IS NOT NULL");
    return new Map(rows.rows.map((r) => [int(r.legacy_issue), int(r.id)]));
  });
  return out ?? new Map();
}

export async function setParent(scope: string, id: number, parentId: number | null): Promise<void> {
  await withDb(scope, async (db) => {
    await db.execute({ sql: "UPDATE wishes SET parent_id = ? WHERE id = ?", args: [parentId, id] });
    return true;
  });
}

// ── claiming, for more than one worker ──────────────────────────────────────

/**
 * A claim is a LEASE, not a flag.
 *
 * The old claim was read-then-write: read the wish, see `ready`, write
 * `building`. Two workers reading at the same time both see `ready` and both
 * write, and both believe they own it — the second write succeeds because
 * nothing in it says "only if still unclaimed". They then build the same wish
 * twice, on two branches, and one of them loses its work at merge.
 *
 * The fix is not a lock. It is putting the precondition inside the UPDATE, so
 * the database decides the winner in one statement: `rowsAffected === 1` means
 * you own it, `0` means somebody else does. There is no window between the
 * check and the write because there is no separate check.
 *
 * And it EXPIRES — which is about death, not contention. A flag would need
 * somebody to notice that a worker died holding it, and nobody will, so the
 * wish would sit in `building` for ever looking busy. A lease that runs out
 * returns it to the pool on its own.
 *
 * There is no heartbeat, deliberately. A heartbeat buys a shorter lease, and a
 * shorter lease only matters when workers are contending for scarce wishes —
 * which is not this system. Instead the lease is long enough to outlast any
 * plausible run, so nothing has to keep it alive, and the cost of that choice
 * is the only thing it costs: a crashed worker's wish waits hours rather than
 * minutes before somebody else can take it. That is a fine trade when the queue
 * is not the bottleneck, and it removes a moving part the worker would
 * otherwise have to remember.
 */
export const CLAIM_TTL_SECONDS = Number(process.env.WISH_CLAIM_TTL_SECONDS) || 8 * 60 * 60;

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: "taken" | "not-claimable" | "unreachable" };

/**
 * Try to take a wish. Atomic.
 *
 * Deliberately NOT checked here: whether the wish is blocked. A blocker can
 * live in a different product's database — the platform half of a split sits in
 * `site` while the blocked half sits in the product — so the join does not
 * exist in SQL and the caller checks it against the board it already loaded.
 */
export async function claimWish(
  scope: string,
  id: number,
  workerId: string,
  ttlSeconds = CLAIM_TTL_SECONDS,
): Promise<ClaimResult> {
  const now = Math.floor(Date.now() / 1000);
  const res = await withDb(scope, async (db) => {
    const out = await db.execute({
      sql: `UPDATE wishes
               SET stage = 'building',
                   claimed_by = ?,
                   claim_expires_at = ?,
                   updated_at = unixepoch()
             WHERE id = ?
               AND stage IN ('backlog', 'ready', 'building')
               AND (claimed_by IS NULL OR claimed_by = ? OR claim_expires_at IS NULL OR claim_expires_at < ?)`,
      args: [workerId, now + ttlSeconds, id, workerId, now],
    });
    return Number(out.rowsAffected ?? 0);
  });

  if (res === null) return { ok: false, reason: "unreachable" };
  if (res === 1) return { ok: true };

  // Zero rows: either somebody holds a live lease, or the wish is in a stage
  // nothing may claim. Distinguish them, because the two need different words.
  const w = await getDbWish(scope, id);
  return { ok: false, reason: w && (w.status === "building" || w.status === "review") ? "taken" : "not-claimable" };
}

/** Put a wish back, on purpose. The polite version of dying. */
export async function releaseClaim(scope: string, id: number, workerId: string, backTo: "ready" | "review" = "ready"): Promise<boolean> {
  const res = await withDb(scope, async (db) => {
    const out = await db.execute({
      sql: `UPDATE wishes SET stage = ?, claimed_by = NULL, claim_expires_at = NULL, updated_at = unixepoch()
             WHERE id = ? AND claimed_by = ?`,
      args: [backTo, id, workerId],
    });
    return Number(out.rowsAffected ?? 0);
  });
  return res === 1;
}

/** Who holds this wish, if anyone still does. An expired lease reads as free —
 *  the same rule `claimWish` applies, so the board and the claim never disagree. */
export async function claimHolder(scope: string, id: number): Promise<{ workerId: string; expiresAt: number } | null> {
  const row = await withDb(scope, async (db) => {
    const out = await db.execute({ sql: "SELECT claimed_by, claim_expires_at FROM wishes WHERE id = ?", args: [id] });
    return out.rows[0] ?? null;
  });
  if (!row || !row.claimed_by) return null;
  const expiresAt = Number(row.claim_expires_at ?? 0);
  return expiresAt > Math.floor(Date.now() / 1000) ? { workerId: String(row.claimed_by), expiresAt } : null;
}
