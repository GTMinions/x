import "server-only";

/**
 * The identity database.
 *
 * This app used to be a guest here: a separate accounts service owned the schema, ran every
 * migration, and this side was under standing orders never to run DDL. That is
 * why a fresh clone failed with a bare "no such table" — the tables were somebody
 * else's to create.
 *
 * x owns them now. `dbReady` runs an idempotent CREATE TABLE IF NOT EXISTS pass
 * on first use, so `pnpm dev` on a clean checkout produces a working sign-in with
 * no external service and no migration step to remember. Pointing
 * `ACCOUNTS_DATABASE_URL` at an existing accounts DB still works: every statement
 * is IF NOT EXISTS, so it adopts the tables already there instead of fighting them.
 *
 * Unset URL → a local SQLite file. That is a real, working database, not a stub,
 * which is what lets the project run with no secrets at all.
 */

import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";

import { dbName, ensureDatabase, tursoAutoProvision } from "../turso";
import * as schema from "./schema";

/**
 * Whether identity is on a real, shared database.
 *
 * True when one is named OUTRIGHT, and also when Turso auto-provisioning is
 * configured — in that mode the database exists after the first request even
 * if nobody named it. False means the local file, which is fine for dev and
 * for a single long-lived server, and wrong for serverless: each instance
 * would get its own file and sessions would not cross.
 */
export function accountsDbConfigured(): boolean {
  return Boolean(process.env.ACCOUNTS_DATABASE_URL) || tursoAutoProvision();
}

/**
 * Where identity lives, in precedence order.
 *
 *   1. ACCOUNTS_DATABASE_URL   — named outright; used exactly as given.
 *   2. auto-provisioned         — `<prefix>-identity`, created on first use,
 *                                 when TURSO_API_TOKEN + TURSO_ORG are set.
 *   3. ./identity.db            — a real, working SQLite file. This is what
 *                                 lets the project run with no secrets at all,
 *                                 and it is a per-instance file, so it warns.
 */
async function resolveTarget(): Promise<{ url: string; authToken?: string; how: string }> {
  const named = process.env.ACCOUNTS_DATABASE_URL?.trim();
  if (named) return { url: named, authToken: process.env.ACCOUNTS_DATABASE_AUTH_TOKEN, how: "ACCOUNTS_DATABASE_URL" };

  if (tursoAutoProvision()) {
    const t = await ensureDatabase("identity");
    return { url: t.url, authToken: t.authToken, how: `auto-provisioned ${dbName("identity")}` };
  }

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[identity] no ACCOUNTS_DATABASE_URL and no TURSO_API_TOKEN — using a local " +
        "file. On serverless each instance gets its own copy, so sign-in will appear " +
        "to work and then forget you. Set one of the two.",
    );
  }
  return { url: "file:./identity.db", how: "local file" };
}

/**
 * The client and the drizzle handle, resolved by `dbReady`.
 *
 * They cannot be built at module scope any more: choosing the target may mean
 * an API call. Every caller already awaits `dbReady` before its first query —
 * that was true when this only ran migrations — so the binding below stays a
 * plain `db.select(...)` and nothing at any call site changes.
 */
let _client: Client | null = null;
let _db: LibSQLDatabase<typeof schema> | null = null;

/** Forwards to the real handle once `dbReady` has settled, and says plainly
 *  what went wrong if someone forgot to await it. */
export const db = new Proxy({} as LibSQLDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    if (!_db) {
      throw new Error(
        "The identity database is not open yet. `await dbReady` before the first query — " +
          "opening it can require provisioning, so it is no longer synchronous.",
      );
    }
    const value = Reflect.get(_db, prop, receiver);
    return typeof value === "function" ? value.bind(_db) : value;
  },
});

/** The raw libsql client, for the few callers that need one. Same rule. */
export function client(): Client {
  if (!_client) throw new Error("The identity database is not open yet — `await dbReady` first.");
  return _client;
}

/**
 * The schema, as executable statements.
 *
 * Written out rather than generated so there is no migration tool in the runtime
 * path. Keep in lockstep with ./schema.ts — that file is the types, this is the
 * storage, and a column added to one must be added to the other.
 */
const DDL = [
  `CREATE TABLE IF NOT EXISTS accounts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     external_id TEXT NOT NULL,
     account_type TEXT NOT NULL,
     display_name TEXT,
     avatar_url TEXT,
     status TEXT NOT NULL DEFAULT 'active',
     primary_email TEXT,
     primary_phone TEXT,
     locale TEXT DEFAULT 'en',
     created_at INTEGER NOT NULL DEFAULT (unixepoch()),
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_external_id_unique ON accounts (external_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_primary_email_unique ON accounts (primary_email)`,
  `CREATE INDEX IF NOT EXISTS accounts_type_idx ON accounts (account_type)`,

  `CREATE TABLE IF NOT EXISTS account_emails (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id INTEGER NOT NULL,
     email TEXT NOT NULL,
     verified INTEGER NOT NULL DEFAULT 0,
     added_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS account_emails_email_unique ON account_emails (email)`,
  `CREATE INDEX IF NOT EXISTS account_emails_account_idx ON account_emails (account_id)`,

  `CREATE TABLE IF NOT EXISTS account_oauth_links (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id INTEGER NOT NULL,
     provider TEXT NOT NULL,
     provider_user_id TEXT NOT NULL,
     raw_profile TEXT,
     added_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS oauth_links_provider_user_unique ON account_oauth_links (provider, provider_user_id)`,
  `CREATE INDEX IF NOT EXISTS oauth_links_account_idx ON account_oauth_links (account_id)`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     account_id INTEGER NOT NULL,
     refresh_token_hash TEXT NOT NULL,
     user_agent TEXT,
     ip TEXT,
     issued_at INTEGER NOT NULL DEFAULT (unixepoch()),
     expires_at INTEGER NOT NULL,
     revoked_at INTEGER,
     last_used_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sessions_refresh_unique ON sessions (refresh_token_hash)`,

  `CREATE TABLE IF NOT EXISTS otp_codes (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     channel TEXT NOT NULL,
     target TEXT NOT NULL,
     code_hash TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     consumed_at INTEGER,
     attempts INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE INDEX IF NOT EXISTS otp_codes_target_idx ON otp_codes (channel, target)`,


  `CREATE TABLE IF NOT EXISTS wish_owners (
     wish_id INTEGER PRIMARY KEY,
     account_id INTEGER NOT NULL,
     created_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE INDEX IF NOT EXISTS wish_owners_account_idx ON wish_owners (account_id)`,

  `CREATE TABLE IF NOT EXISTS memberships (
     scope_type TEXT NOT NULL,
     scope_id   TEXT NOT NULL,
     email      TEXT NOT NULL,
     role       TEXT NOT NULL,
     granted_at TEXT NOT NULL,
     PRIMARY KEY (scope_type, scope_id, email)
   )`,
  `CREATE INDEX IF NOT EXISTS memberships_email_idx ON memberships (email)`,
  `CREATE INDEX IF NOT EXISTS memberships_scope_idx ON memberships (scope_type, scope_id)`,

  `CREATE TABLE IF NOT EXISTS account_usage (
     account_id     INTEGER PRIMARY KEY,
     tokens_in      INTEGER NOT NULL DEFAULT 0,
     tokens_out     INTEGER NOT NULL DEFAULT 0,
     bytes_stored   INTEGER NOT NULL DEFAULT 0,
     wishes_filed   INTEGER NOT NULL DEFAULT 0,
     credits_purchased INTEGER NOT NULL DEFAULT 0,
     credits_spent     INTEGER NOT NULL DEFAULT 0,
     tier              TEXT NOT NULL DEFAULT 'free',
     started_at        INTEGER,
     has_card          INTEGER NOT NULL DEFAULT 0,
     stripe_customer_test TEXT,
     stripe_customer_live TEXT,
     updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
   )`,

  `CREATE TABLE IF NOT EXISTS workers (
     id            TEXT PRIMARY KEY,
     label         TEXT,
     registered_at INTEGER NOT NULL DEFAULT (unixepoch()),
     last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch()),
     note          TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS token_ledger (
     id                 INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id         INTEGER NOT NULL,
     wish_id            INTEGER,
     scope              TEXT,
     worker_id          TEXT,
     model              TEXT,
     credits_charged    INTEGER NOT NULL DEFAULT 0,
     tokens_per_credit  INTEGER,
     input_tokens       INTEGER NOT NULL DEFAULT 0,
     cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
     cache_write_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens      INTEGER NOT NULL DEFAULT 0,
     list_cost_cents    INTEGER,
     idempotency_key    TEXT NOT NULL,
     created_at         INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE TABLE IF NOT EXISTS fulfilments (
     account_id INTEGER NOT NULL,
     wish_id    INTEGER NOT NULL,
     day        TEXT NOT NULL,
     month      TEXT NOT NULL,
     created_at INTEGER NOT NULL DEFAULT (unixepoch()),
     PRIMARY KEY (account_id, wish_id)
   )`,
  `CREATE INDEX IF NOT EXISTS fulfilments_account_day ON fulfilments (account_id, day)`,
  `CREATE INDEX IF NOT EXISTS fulfilments_account_month ON fulfilments (account_id, month)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS token_ledger_key_unique ON token_ledger (idempotency_key)`,
  `CREATE INDEX IF NOT EXISTS token_ledger_account_idx ON token_ledger (account_id)`,
  `CREATE INDEX IF NOT EXISTS token_ledger_wish_idx ON token_ledger (wish_id)`,

  `CREATE TABLE IF NOT EXISTS site_settings (
     key        TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
     updated_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS tiers (
     id            TEXT PRIMARY KEY,
     name          TEXT NOT NULL,
     price_cents   INTEGER NOT NULL DEFAULT 0,
     per_day       INTEGER,
     per_month     INTEGER,
     rank          INTEGER NOT NULL DEFAULT 0,
     requires_card INTEGER NOT NULL DEFAULT 1,
     blurb         TEXT NOT NULL DEFAULT '',
     listed        INTEGER NOT NULL DEFAULT 1,
     stripe_price_test TEXT,
     stripe_price_live TEXT,
     updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
     updated_by    TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS comps (
     email      TEXT PRIMARY KEY,
     note       TEXT,
     granted_by TEXT,
     created_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE INDEX IF NOT EXISTS comps_created_idx ON comps (created_at)`,

  `CREATE TABLE IF NOT EXISTS signing_keys (
     kid TEXT PRIMARY KEY,
     alg TEXT NOT NULL DEFAULT 'RS256',
     public_jwk TEXT NOT NULL,
     private_pem TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1,
     retired_at INTEGER,
     created_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,

];

/**
 * Column renames that an already-populated database needs.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so a
 * rename in the DDL above would leave an adopted database on the OLD column
 * while drizzle asked for the new one. Drizzle's `select()` names every column
 * in the schema, so that mismatch is not a dormant inconsistency — it breaks
 * every account lookup with "no such column".
 *
 * Each entry is applied only when the old column is present and the new one is
 * not, so this is safe to run on every boot and on a fresh database.
 */
/** Column renames an adopted database may need. None outstanding. */
const RENAMES: { table: string; from: string; to: string }[] = [];

/**
 * Columns ADDED to a table that already exists — the same blind spot as a
 * rename, from the other direction.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, so a column
 * added to the DDL above never reaches a database that was created before it.
 * Drizzle then names that column in every `select()` and the whole table stops
 * reading. Applied only when the table exists and the column does not, so this
 * is a no-op on a fresh database and safe on every boot.
 */
const ADDITIONS: { table: string; column: string; ddl: string }[] = [
  { table: "tiers", column: "stripe_price_test", ddl: "TEXT" },
  { table: "tiers", column: "stripe_price_live", ddl: "TEXT" },
  { table: "token_ledger", column: "credits_charged", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "token_ledger", column: "tokens_per_credit", ddl: "INTEGER" },
  { table: "account_usage", column: "credits_purchased", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "account_usage", column: "credits_spent", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "account_usage", column: "tier", ddl: "TEXT NOT NULL DEFAULT 'free'" },
  { table: "account_usage", column: "started_at", ddl: "INTEGER" },
  { table: "account_usage", column: "has_card", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "account_usage", column: "stripe_customer_test", ddl: "TEXT" },
  { table: "account_usage", column: "stripe_customer_live", ddl: "TEXT" },
  // SQLite refuses a non-constant default on ADD COLUMN, so this one is added
  // nullable and read with a fallback rather than defaulted to unixepoch().
];

/**
 * Bring the schema up to date in TWO round trips, not fifty.
 *
 * This used to run every statement individually: ~32 CREATEs, then a PRAGMA per
 * probed table, then any ALTERs — each a separate HTTPS request to the
 * database. On a serverless cold start that bill is paid before the first real
 * query, and it WAS the cold start: several seconds of sequential round trips
 * to (re)create tables that already existed.
 *
 * Now: one batch for the idempotent DDL, one batch for every PRAGMA probe, and
 * individual ALTERs only for columns that are actually missing — which after
 * the first deploy is none. Steady-state cold start: 2 round trips.
 *
 * The batch falls back to the old per-statement loop when it fails as a unit:
 * a batch runs transactionally, and an adopted database with one odd index
 * must degrade to "skip that statement", not to "no schema at all".
 */
async function migrate(): Promise<void> {
  const c = _client!;

  try {
    await c.batch(DDL, "write");
  } catch (e) {
    console.warn("[identity] DDL batch failed, retrying statement by statement:", (e as Error).message);
    for (const stmt of DDL) {
      try {
        await c.execute(stmt);
      } catch (err) {
        console.warn("[identity] schema statement skipped:", (err as Error).message);
      }
    }
  }

  // Every probe in one round trip. The result sets line up with the tables
  // asked about, so missing columns fall out of a single pass.
  const tables = [...new Set([...ADDITIONS.map((a) => a.table), ...RENAMES.map((r) => r.table)])];
  const cols = new Map<string, Set<string>>();
  try {
    const results = await c.batch(tables.map((t) => `PRAGMA table_info(${t})`), "read");
    tables.forEach((t, i) =>
      cols.set(t, new Set(results[i]!.rows.map((row) => String((row as Record<string, unknown>).name)))),
    );
  } catch {
    // A probe that fails leaves the map empty, which skips every conditional
    // change below — the safe direction: nothing altered blind.
  }

  for (const add of ADDITIONS) {
    const have = cols.get(add.table);
    if (!have?.size || have.has(add.column)) continue;
    try {
      await c.execute(`ALTER TABLE ${add.table} ADD COLUMN ${add.column} ${add.ddl}`);
      console.warn(`[identity] added ${add.table}.${add.column}`);
    } catch (e) {
      // "Already there" is the expected outcome of a race, not a failure: a
      // build renders pages in several processes at once, they all probe, they
      // all see the column missing, and they all try to add it. One wins. The
      // column exists either way, which is the only thing the caller needs —
      // reporting a schema error here sent people looking for a broken table.
      if (/duplicate column/i.test(String((e as Error)?.message ?? e))) continue;
      console.error(
        `[identity] could not add ${add.table}.${add.column}. Reads of that table will ` +
          "fail until the column matches the schema.",
        e,
      );
    }
  }

  for (const r of RENAMES) {
    const have = cols.get(r.table);
    if (!have?.size || have.has(r.to) || !have.has(r.from)) continue;
    try {
      await c.execute(`ALTER TABLE ${r.table} RENAME COLUMN ${r.from} TO ${r.to}`);
      console.warn(`[identity] renamed ${r.table}.${r.from} → ${r.to}`);
    } catch (e) {
      console.error(
        `[identity] could not rename ${r.table}.${r.from} → ${r.to}. Account reads will ` +
          "fail until the column matches the schema.",
        e,
      );
    }
  }
}

/**
 * Open the database, then bring its schema up to date. Awaited by every
 * identity helper before its first query; runs once per process.
 */
export const dbReady: Promise<void> = (async () => {
  const target = await resolveTarget();
  _client = createClient({ url: target.url, authToken: target.authToken });
  _db = drizzle(_client, { schema });
  await migrate();
  if (target.how !== "ACCOUNTS_DATABASE_URL") console.log(`[identity] ${target.how}`);
})();
