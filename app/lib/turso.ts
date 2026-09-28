/**
 * Databases that create themselves.
 *
 * WHAT THIS IS FOR
 * Someone clones this repository, deploys it, and expects it to work. Before
 * this module the answer was: install the `turso` CLI, log in interactively,
 * run `product:db provision` once per product, and paste eight environment
 * variables into your host. That is a fine workflow for the person who wrote it
 * and a wall for everybody else — and none of it is possible from inside a
 * serverless function, where there is no CLI and no browser to log in with.
 *
 * So: give the platform `TURSO_API_TOKEN` and `TURSO_ORG` and it provisions
 * what it needs, when it first needs it, over plain HTTP.
 *
 *   no env at all        → local SQLite files. Works, single-instance only.
 *   TURSO_API_TOKEN+ORG  → real databases, created on first use.
 *   explicit PRODUCT_DB_*_URL → used as-is, and this module stays out of it.
 *
 * The third case is deliberately first in precedence. An operator who named a
 * database means it, and a platform that quietly created a second one next to
 * theirs would be the worst of the three behaviours.
 *
 * WHY A GROUP TOKEN
 * Turso can mint a token scoped to a *group*, which authenticates every
 * database in it. One secret instead of one per product, nothing to store per
 * database, and a new product needs no new credential — which is what makes
 * "create it on demand" possible at all. The alternative, minting and then
 * persisting a token per database, means writing credentials to a table on a
 * request path, and having somewhere to put them before the place to put them
 * exists.
 *
 * WHAT THIS DOES NOT DO
 * Delete anything. There is no drop, no rename, no destructive call in this
 * file, and the API token — which can destroy every database in the account —
 * is only ever used to read and to create.
 *
 * THE CEILING
 * Creating a database is the one expensive, irreversible-ish thing this file
 * can do, and it does it in response to a request. `TURSO_MAX_DATABASES` bounds
 * how many this deployment will ever create, so a bug or an attacker who can
 * influence a scope name cannot run the account up. It is a blunt instrument on
 * purpose: the failure it prevents is unbounded spend, and the cost of it
 * firing wrongly is one loud error rather than a quiet bill.
 */

const API = "https://api.turso.tech";

export type TursoTarget = { url: string; authToken?: string };

// ── configuration ───────────────────────────────────────────────────────────

const apiToken = () => process.env.TURSO_API_TOKEN?.trim() || null;
const org = () => process.env.TURSO_ORG?.trim() || null;
const group = () => process.env.TURSO_GROUP?.trim() || "default";

/** Whether the platform may create databases for itself. Both halves are
 *  required: a token with no organisation has nowhere to create them. */
export function tursoAutoProvision(): boolean {
  return Boolean(apiToken() && org());
}

/**
 * The most databases this deployment will create, ever.
 *
 * Default 12: one for identity, one per product, and room to add a few without
 * anyone editing config. Raise it deliberately when you genuinely have more
 * products — the number existing is what makes "unbounded" impossible.
 */
export function maxDatabases(): number {
  const raw = Number(process.env.TURSO_MAX_DATABASES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 12;
}

/** Databases this deployment has created or adopted in this process. Counted
 *  rather than queried: the ceiling is on what WE create, not on what already
 *  exists in an account that may be shared with other projects. */
let created = 0;

/**
 * The database name for a scope.
 *
 * `site`, `gtm`, `ai-edu` → `gtminions-x-site`, and so on. Same rule as
 * `scripts/product-db.ts` uses, so a database provisioned by the CLI and one
 * created here are the same database rather than two with different names.
 *
 * `TURSO_DB_PREFIX` lets two deployments share one Turso account without
 * colliding — a fork, or a staging environment beside production.
 */
export function dbName(scope: string): string {
  const prefix = process.env.TURSO_DB_PREFIX?.trim() || "gtminions-x";
  return `${prefix}-${scope}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

// ── transport ───────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

async function api(path: string, init?: { method?: string; body?: Json }): Promise<unknown> {
  const token = apiToken();
  if (!token) throw new Error("TURSO_API_TOKEN is not set");

  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 404) return null; // "does not exist" is an answer, not a failure
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) detail = j.error;
    } catch {
      /* non-JSON body */
    }
    // Never includes the token — the message is Turso's own.
    throw new Error(`Turso ${res.status} on ${path}: ${detail}`);
  }
  return res.json();
}

// ── creating ────────────────────────────────────────────────────────────────

/**
 * Make sure a database exists, and return how to reach it.
 *
 * Read before write: an existing database is the overwhelmingly common case
 * (every request after the first), and asking first means a create is never
 * attempted against a name already in use.
 *
 * In-flight calls are shared. Two requests arriving together on a cold instance
 * would otherwise both try to create the same database, and one of them would
 * get an error for a database that does exist by the time it reads the reply.
 */
const inFlight = new Map<string, Promise<TursoTarget>>();
const resolved = new Map<string, TursoTarget>();

export async function ensureDatabase(scope: string): Promise<TursoTarget> {
  const name = dbName(scope);

  const cached = resolved.get(name);
  if (cached) return cached;

  const running = inFlight.get(name);
  if (running) return running;

  const work = (async (): Promise<TursoTarget> => {
    const o = org();
    if (!o) throw new Error("TURSO_ORG is not set");

    let db = (await api(`/v1/organizations/${o}/databases/${name}`)) as { database?: { Hostname?: string } } | null;

    if (!db) {
      // Checked only on the create path: adopting a database that already
      // exists costs nothing and must never be refused by a spend guard.
      if (created >= maxDatabases()) {
        throw new Error(
          `Refusing to create ${name}: this deployment has already created ${created} databases, ` +
            `which is TURSO_MAX_DATABASES (${maxDatabases()}). Raise it deliberately if that is genuinely ` +
            "how many products you have — the cap exists so a bug cannot run the account up.",
        );
      }
      console.log(`[turso] creating ${name} in group ${group()} …`);
      db = (await api(`/v1/organizations/${o}/databases`, {
        method: "POST",
        body: { name, group: group() },
      })) as { database?: { Hostname?: string } } | null;
      if (!db) throw new Error(`Turso refused to create ${name} and gave no reason`);
      created++;
    }

    const host = db.database?.Hostname;
    if (!host) throw new Error(`Turso described ${name} without a hostname`);

    const target: TursoTarget = { url: `libsql://${host}`, authToken: await groupToken() };
    resolved.set(name, target);
    return target;
  })();

  inFlight.set(name, work);
  try {
    return await work;
  } finally {
    inFlight.delete(name);
  }
}

// ── the group token ─────────────────────────────────────────────────────────

let cachedGroupToken: Promise<string> | null = null;

/**
 * A token that authenticates every database in the group.
 *
 * `TURSO_GROUP_TOKEN` short-circuits this, and a real deployment should set it:
 * minting is a network call on every cold start, and on serverless that is most
 * requests. Minting is the fallback so that a first deploy works with nothing
 * but the API token — you can copy the value out of the logs later, or not
 * bother.
 */
export function groupToken(): Promise<string> {
  const supplied = process.env.TURSO_GROUP_TOKEN?.trim();
  if (supplied) return Promise.resolve(supplied);

  if (!cachedGroupToken) {
    cachedGroupToken = (async () => {
      const o = org();
      if (!o) throw new Error("TURSO_ORG is not set");
      const r = (await api(`/v1/organizations/${o}/groups/${group()}/auth/tokens`, { method: "POST" })) as
        | { jwt?: string }
        | null;
      if (!r?.jwt) throw new Error(`Turso would not mint a token for group ${group()}`);
      return r.jwt;
    })().catch((e) => {
      // Do not cache a rejection: a transient failure would otherwise poison
      // every later call in this process.
      cachedGroupToken = null;
      throw e;
    });
  }
  return cachedGroupToken;
}

// ── the one function callers need ───────────────────────────────────────────

/**
 * Where a scope's database lives, in precedence order.
 *
 *   1. `PRODUCT_DB_<SCOPE>_URL`  — an operator named it; use exactly that.
 *   2. auto-provision            — if a Turso API token is configured.
 *   3. null                      — caller falls back to a local file or memory,
 *                                  and says so. Never a silent failure.
 */
export async function resolveScopeDb(scope: string): Promise<TursoTarget | null> {
  const key = `PRODUCT_DB_${scope.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const explicit = process.env[`${key}_URL`]?.trim();
  if (explicit) return { url: explicit, authToken: process.env[`${key}_TOKEN`]?.trim() };

  if (!tursoAutoProvision()) return null;

  try {
    return await ensureDatabase(scope);
  } catch (e) {
    // Reported, not thrown: a product whose database cannot be reached should
    // degrade to "this product's data is unavailable", not take the site down.
    console.error(`[turso] could not provision a database for "${scope}":`, (e as Error).message);
    return null;
  }
}
