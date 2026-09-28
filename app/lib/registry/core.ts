/**
 * The product registry — what products exist, and how to reach each one's
 * database. It lives in the site database, not in code.
 *
 * WHY A TABLE AND NOT AN ARRAY
 * A product used to be a row in `app/lib/products.ts`, which meant a product
 * existed because the code said so, whether or not anything behind it did. The
 * folder under app/(products) is only the product's *pages*; its content, its
 * data and its words are in its own database. So the database is what makes a
 * product real, and the list of real products is a table: a product whose
 * database this deployment cannot reach is not shown, a product created at
 * runtime (from /setup) is shown without a code change, and a checkout with
 * three product folders but an empty registry has zero products.
 *
 * TWO MODES
 *   hosted  Turso databases, one per scope, created on first use through
 *           ./turso when TURSO_API_TOKEN + TURSO_ORG are set. What a Vercel
 *           deployment runs on.
 *   local   SQLite files under .local-db/, one per scope, no account needed.
 *           What `install.sh` gives you on one machine. On serverless each
 *           instance would get its own file, so it warns there.
 *
 * WHERE THE SITE DATABASE IS
 * `PRODUCT_DB_SITE_URL` if an operator named it; else Turso (hosted mode);
 * else `.local-db/site.db` (local mode). There is always a registry.
 *
 * WHERE A PRODUCT'S DATABASE IS — `productCredentials`
 *   1. `PRODUCT_DB_<SLUG>_URL` / `_TOKEN`: an operator named it; used as-is.
 *   2. The registry row's `db_url`, written when the product was provisioned;
 *      its own token if the row has one, else the group token (./turso).
 *   3. Turso, `<prefix>-<slug>`, created on first use (hosted mode).
 *   4. `.local-db/<slug>.db` (local mode).
 *
 * WISH-ID BLOCKS
 * Wish ids are partitioned per scope (app/_platform/wishes/ids.ts). The code
 * table seeds the scopes that ship with the platform; a product created at
 * runtime gets the next free block here, in `wish_block`, and `wishBlocks()`
 * hands the map to the id functions.
 *
 * TESTS
 * `PRODUCT_REGISTRY_FIXTURE` (JSON array of products) replaces the database
 * for the test runner, which never touches the network.
 *
 * Plain module, no `server-only`: scripts and the wish store run it under tsx.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { groupToken, resolveScopeDb, tursoAutoProvision } from "../turso";
import { WISH_ID_BLOCKS } from "@/app/_platform/wishes/ids";

export type ProductStatus = "active" | "frozen";
/**
 * `public`   readable by anyone signed in, listed for everyone.
 * `unlisted` readable by anyone with the link, listed only for members.
 * `private`  readable and listed only with a grant (app/lib/access.ts).
 */
export type Visibility = "public" | "unlisted" | "private";

export type Product = {
  slug: string; // globally unique, lowercase-kebab; also the route + folder name
  teamSlug: string; // owning tenant
  name: string; // display name
  tagline: string; // one line
  accent: string; // product accent (overrides --accent on its shell)
  status: ProductStatus;
  visibility: Visibility;
  /** Does this product ship a research site? */
  hasResearch: boolean;
  prdUrl?: string | null;
  figmaUrl?: string | null;
  /** The wish-id block (app/_platform/wishes/ids.ts); null for scopes the code table covers. */
  wishBlock?: number | null;
  createdAt?: number;
};

export type Team = { slug: string; name: string };

/** A registry row: the product plus where its database is (may be unset). */
export type ProductRow = Product & { dbUrl: string | null; dbToken: string | null };

/** `ai-edu` → `PRODUCT_DB_AI_EDU_URL`. Shared with scripts/product-db.ts. */
export const envKey = (slug: string, suffix: "URL" | "TOKEN") =>
  `PRODUCT_DB_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;

// ── the site database ────────────────────────────────────────────────────────

const fixture = (): Product[] | null => {
  const raw = process.env.PRODUCT_REGISTRY_FIXTURE;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Product[];
  } catch {
    throw new Error("PRODUCT_REGISTRY_FIXTURE is not valid JSON");
  }
};

export type RegistryMode = "fixture" | "named" | "hosted" | "local";

/** Which of the modes this process is in (see the header). */
export function registryMode(): RegistryMode {
  if (fixture()) return "fixture";
  if (process.env[envKey("site", "URL")]) return "named";
  if (tursoAutoProvision()) return "hosted";
  return "local";
}

/** There is always a registry: local mode is a file. Kept for callers that ask. */
export function siteDbConfigured(): boolean {
  return true;
}

export const LOCAL_DB_DIR = ".local-db";
let _localWarned = false;

/**
 * Local mode: one SQLite file per scope under .local-db/ (gitignored). A real,
 * working database — the demo product loads into it and everything reads from
 * it — and a per-machine one, which is the trade local mode makes.
 */
export function localTarget(scope: string): { url: string; authToken?: string } {
  const dir = path.join(process.cwd(), LOCAL_DB_DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* read-only fs: the open below reports the real error */
  }
  if (process.env.VERCEL && !_localWarned) {
    _localWarned = true;
    console.warn("[registry] local SQLite mode on a serverless host: each instance gets its own file. Set TURSO_API_TOKEN + TURSO_ORG for a shared database.");
  }
  return { url: `file:${path.join(dir, `${scope.replace(/[^a-z0-9-]/gi, "-")}.db`)}` };
}

let _site: Promise<Client> | null = null;

/** The site database, in whichever mode applies. */
export function siteDb(): Promise<Client> {
  if (!_site) {
    _site = (async () => {
      const target = (await resolveScopeDb("site")) ?? localTarget("site");
      return createClient({ url: target.url, authToken: target.authToken });
    })().catch((err) => {
      _site = null;
      throw err;
    });
  }
  return _site;
}

export const REGISTRY_DDL = [
  `CREATE TABLE IF NOT EXISTS teams (
     slug       TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     created_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE TABLE IF NOT EXISTS products (
     slug         TEXT PRIMARY KEY,
     team_slug    TEXT NOT NULL,
     name         TEXT NOT NULL,
     tagline      TEXT NOT NULL DEFAULT '',
     accent       TEXT NOT NULL DEFAULT '#356a4d',
     status       TEXT NOT NULL DEFAULT 'active',
     visibility   TEXT NOT NULL DEFAULT 'private',
     has_research INTEGER NOT NULL DEFAULT 1,
     prd_url      TEXT,
     figma_url    TEXT,
     db_url       TEXT,
     db_token     TEXT,
     wish_block   INTEGER,
     created_at   INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
];
const REGISTRY_ALTERS = [`ALTER TABLE products ADD COLUMN wish_block INTEGER`];

let _migrated: Promise<void> | null = null;

/** Idempotent; memoised per process so every read does not pay for it. */
export function migrateRegistry(db: Client): Promise<void> {
  if (!_migrated) {
    _migrated = (async () => {
      for (const s of REGISTRY_DDL) await db.execute(s);
      for (const s of REGISTRY_ALTERS) {
        try {
          await db.execute(s);
        } catch (err) {
          if (!/duplicate column/i.test((err as Error).message)) throw err;
        }
      }
    })().catch((err) => {
      _migrated = null;
      throw err;
    });
  }
  return _migrated;
}

async function ready(db?: Client): Promise<Client> {
  const c = db ?? (await siteDb());
  await migrateRegistry(c);
  return c;
}

function rowToProduct(r: Record<string, unknown>): ProductRow {
  const vis = String(r.visibility ?? "private");
  return {
    slug: String(r.slug),
    teamSlug: String(r.team_slug),
    name: String(r.name),
    tagline: String(r.tagline ?? ""),
    accent: String(r.accent ?? "#356a4d"),
    status: (r.status === "frozen" ? "frozen" : "active") as ProductStatus,
    visibility: (vis === "public" || vis === "unlisted" ? vis : "private") as Visibility,
    hasResearch: Number(r.has_research ?? 1) !== 0,
    prdUrl: (r.prd_url as string | null) ?? null,
    figmaUrl: (r.figma_url as string | null) ?? null,
    wishBlock: r.wish_block == null ? null : Number(r.wish_block),
    createdAt: Number(r.created_at ?? 0),
    dbUrl: (r.db_url as string | null) ?? null,
    dbToken: (r.db_token as string | null) ?? null,
  };
}

// ── raw reads and writes ─────────────────────────────────────────────────────

export async function fetchTeams(db?: Client): Promise<Team[]> {
  if (fixture()) return [{ slug: "growth-labs", name: "Growth Labs" }];
  const c = await ready(db);
  const rs = await c.execute("SELECT slug, name FROM teams ORDER BY created_at, slug");
  return rs.rows.map((r) => ({ slug: String(r.slug), name: String(r.name) }));
}

export async function fetchProducts(db?: Client): Promise<ProductRow[]> {
  const fx = fixture();
  if (fx) return fx.map((p) => ({ ...p, dbUrl: null, dbToken: null }));
  const c = await ready(db);
  const rs = await c.execute("SELECT * FROM products ORDER BY created_at, slug");
  return rs.rows.map((r) => rowToProduct(r as unknown as Record<string, unknown>));
}

export async function fetchProduct(slug: string, db?: Client): Promise<ProductRow | null> {
  if (fixture()) return (await fetchProducts()).find((p) => p.slug === slug) ?? null;
  const c = await ready(db);
  const rs = await c.execute({ sql: "SELECT * FROM products WHERE slug = ?", args: [slug] });
  const r = rs.rows[0];
  return r ? rowToProduct(r as unknown as Record<string, unknown>) : null;
}

export async function upsertTeam(team: Team, db?: Client): Promise<void> {
  const c = await ready(db);
  await c.execute({
    sql: `INSERT INTO teams (slug, name) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET name = excluded.name`,
    args: [team.slug, team.name],
  });
  invalidateRegistry();
}

/**
 * Register or update a product. Credentials and the wish block are only
 * written when given, so a metadata update never blanks what the row has.
 */
export async function upsertProduct(
  p: Product & { dbUrl?: string | null; dbToken?: string | null },
  db?: Client,
): Promise<void> {
  const c = await ready(db);
  await c.execute({
    sql: `INSERT INTO products (slug, team_slug, name, tagline, accent, status, visibility, has_research, prd_url, figma_url, db_url, db_token, wish_block)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET
            team_slug = excluded.team_slug, name = excluded.name, tagline = excluded.tagline,
            accent = excluded.accent, status = excluded.status, visibility = excluded.visibility,
            has_research = excluded.has_research, prd_url = excluded.prd_url, figma_url = excluded.figma_url,
            db_url = COALESCE(excluded.db_url, products.db_url),
            db_token = COALESCE(excluded.db_token, products.db_token),
            wish_block = COALESCE(excluded.wish_block, products.wish_block)`,
    args: [
      p.slug, p.teamSlug, p.name, p.tagline, p.accent, p.status, p.visibility, p.hasResearch ? 1 : 0,
      p.prdUrl ?? null, p.figmaUrl ?? null, p.dbUrl ?? null, p.dbToken ?? null, p.wishBlock ?? null,
    ],
  });
  invalidateRegistry();
}

export async function deleteProduct(slug: string, db?: Client): Promise<void> {
  const c = await ready(db);
  await c.execute({ sql: "DELETE FROM products WHERE slug = ?", args: [slug] });
  invalidateRegistry();
}

/** Strip credentials for anything that renders. */
export const publicProduct = (r: ProductRow): Product => {
  const { dbUrl: _u, dbToken: _t, ...p } = r;
  return p;
};

// ── the cached view every reader uses ────────────────────────────────────────

const TTL_MS = 15_000;
let _cache: { at: number; products: Product[]; teams: Team[] } | null = null;
let _inflight: Promise<void> | null = null;
let _warned = false;

async function refresh(): Promise<void> {
  if (registryMode() === "local" && !_warned) {
    _warned = true;
    console.log(`[registry] local mode — products live in ${LOCAL_DB_DIR}/ on this machine`);
  }
  const [rows, teams] = await Promise.all([fetchProducts(), fetchTeams()]);
  _cache = { at: Date.now(), products: rows.map(publicProduct), teams };
}

async function ensure(): Promise<void> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return;
  if (!_inflight) {
    _inflight = refresh()
      .catch((err) => {
        // A registry hiccup must not take every page down: keep the last list.
        console.warn("[registry] could not read the product registry:", (err as Error).message);
        if (!_cache) _cache = { at: Date.now(), products: [], teams: [] };
      })
      .finally(() => {
        _inflight = null;
      });
  }
  await _inflight;
}

/** Every registered product, in registration order, credentials stripped. */
export async function listProducts(): Promise<Product[]> {
  await ensure();
  return _cache!.products;
}

/** The last-read slug list, synchronously; [] before the first read. */
export function cachedProductSlugs(): string[] {
  const fx = fixture();
  if (fx) return fx.map((p) => p.slug);
  return _cache?.products.map((p) => p.slug) ?? [];
}

export async function listProductSlugs(): Promise<string[]> {
  return (await listProducts()).map((p) => p.slug);
}

export async function getProduct(slug: string): Promise<Product | null> {
  await ensure();
  return _cache!.products.find((p) => p.slug === slug) ?? null;
}

export async function listTeams(): Promise<Team[]> {
  await ensure();
  return _cache!.teams;
}

export async function getTeam(slug: string): Promise<Team | null> {
  await ensure();
  return _cache!.teams.find((t) => t.slug === slug) ?? null;
}

/** After a write (register, delete) so the next read sees it at once. */
export function invalidateRegistry(): void {
  _cache = null;
}

// ── wish-id blocks ───────────────────────────────────────────────────────────

/** Every scope's block: the code table, then what the registry assigned. */
export async function wishBlocks(): Promise<Record<string, number>> {
  const out: Record<string, number> = { ...WISH_ID_BLOCKS };
  for (const p of await listProducts()) if (p.wishBlock != null && !(p.slug in out)) out[p.slug] = p.wishBlock;
  return out;
}

/** The next free block for a new product. 99 is the unassigned fallback and is skipped. */
export async function nextWishBlock(): Promise<number> {
  const taken = new Set(Object.values(await wishBlocks()));
  let b = Math.max(0, ...taken) + 1;
  while (taken.has(b) || b === 99) b++;
  return b;
}

// ── credentials ──────────────────────────────────────────────────────────────

/** Where a product's database is (see the header). Never null: local mode is the floor. */
export async function productCredentials(slug: string): Promise<{ url: string; authToken?: string }> {
  const url = process.env[envKey(slug, "URL")];
  if (url) return { url, authToken: process.env[envKey(slug, "TOKEN")] };
  if (slug !== "site" && !fixture()) {
    const row = await fetchProduct(slug).catch(() => null);
    if (row?.dbUrl) return { url: row.dbUrl, authToken: row.dbToken ?? (tursoAutoProvision() && !row.dbUrl.startsWith("file:") ? await groupToken() : undefined) };
  }
  return (await resolveScopeDb(slug)) ?? localTarget(slug);
}
