/**
 * Per-product content database — provision, push, pull.
 *
 * WHY THIS EXISTS
 * A git repository has exactly one visibility boundary. Everything committed is
 * readable by everyone who can read the repo, so a product's research corpus
 * cannot be private while the platform is public. Moving the corpus into a
 * database per product is the only way to separate them: the code stays in git
 * where it is reviewable, the data moves behind a credential.
 *
 * THE TWO LAYERS
 *   shared   — entities / edges / substrates. One schema for every product,
 *              defined by app/_platform/research/types.ts. The platform owns it.
 *   product  — whatever that product's features need. Completely different per
 *              product (ai-edu has 168 domain types, devmentor 153, and they
 *              share none). The PRODUCT owns it, in its own `_schema.sql`.
 *              The platform runs that file and otherwise stays out of it.
 *
 * WHY JSON COLUMNS AND NOT REAL ONES
 * `types.ts` is already the schema, and it grows — the deep entities carry 19
 * fields the shallow ones have never used. Normalising into columns would mean
 * a migration on every product database each time an optional field appears.
 * Storing the document keeps `validate-content` as the thing that enforces
 * shape, which is where that check already lives and works.
 *
 * WHERE A PRODUCT'S DATABASE IS
 * `PRODUCT_DB_<SLUG>_URL` / `_TOKEN` in the environment if set; otherwise the
 * product's row in the registry (the site database, PRODUCT_DB_SITE_*), which
 * `provision` and /setup write. The list of products is that registry, so
 * `pull --all` needs the site database and nothing else.
 *
 * Usage:
 *   pnpm product:db provision <slug> [--name … --tagline … --accent …]
 *                                       create the database (Turso API) + register the product
 *   pnpm product:db list                the registry
 *   pnpm product:db push <slug>         local content  → database
 *   pnpm product:db pull <slug>|--all   database → local content (build step)
 *   pnpm product:db stubs <slug>|--all  data modules from stubs where the real file is absent
 *   pnpm product:db status <slug>       what is in the database
 *   pnpm product:db export <slug> <file>   the whole product as one JSON bundle
 *   pnpm product:db import <slug> <file>   a bundle into the product's database (provisions if needed)
 *   pnpm product:db versions <slug> <rel_path>          every version of a product file
 *   pnpm product:db restore <slug> <rel_path> <version> an older version back on disk (then push)
 *
 * UI COPY
 * The words a product's pages render are content too, so they take the same
 * road: the pages carry content ids (see app/_platform/copy), and the words
 * sit in `ui_copy`, one row per id. `pull` writes them to `_copy.json` beside
 * the data modules; `push` reads the file back. The file is gitignored.
 *
 * The platform itself is the product `site`: no corpus, no data modules, only
 * the copy of its own pages and of the components every product shares. Its
 * database is PRODUCT_DB_SITE_*, its working copy app/_copy.json.
 */
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { exportBundle, importBundle, listFileVersions, migrateContent, putProductFile, readFileVersion, type ProductBundle } from "../app/lib/content-db";
import {
  envKey,
  fetchProduct,
  fetchProducts,
  localTarget,
  nextWishBlock,
  productCredentials,
  publicProduct,
  siteDbConfigured,
  upsertProduct,
  upsertTeam,
  type Product,
} from "../app/lib/registry/core";
import { dbName, ensureDatabase, groupToken } from "../app/lib/turso";

const ROOT = process.cwd();

/**
 * Load `.env.local` by hand.
 *
 * Next.js reads it automatically; a standalone tsx process does not, and adding
 * dotenv for four variables is not worth a dependency. Values already present in
 * the real environment win, so CI and the deployment can override without
 * editing a file.
 */
function loadEnvLocal(): void {
  for (const name of [".env.local", ".env.production.local"]) {
    const f = path.join(ROOT, name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k]) continue;
      process.env[k] = raw!.replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvLocal();

/**
 * A product's folder. `site` is the platform itself, so its folder is the
 * repository root: it has no research corpus and no data modules, and what it
 * syncs is its UI copy (app/_copy.json) plus the platform's own operational
 * files — the loop's run-state and the operator's memory notes — which are the
 * site's private records the way a corpus is a product's.
 */
const productDir = (slug: string) => (slug === "site" ? ROOT : path.join(ROOT, "app", "(products)", slug));

/** The UI copy working copy: app/_copy.json for the site, beside the data modules otherwise. */
const copyFilePath = (slug: string) => (slug === "site" ? path.join(ROOT, "app", COPY_FILE) : path.join(productDir(slug), COPY_FILE));

const contentDir = (slug: string) => path.join(productDir(slug), "research", "content");

// ── working-copy files ───────────────────────────────────────────────────────

/** The UI copy working copy, relative to app/(products)/<slug>/. */
const COPY_FILE = "_copy.json";

/**
 * Entity ages, relative to research/content/. Written by `pull` from the
 * entities table; read by build-topology-history as the floor. `push` reads it
 * too, as a floor to seed from — so a working copy restored from elsewhere (or
 * the old committed cache) can hand the database dates it did not have.
 */
const TIMESTAMPS_FILE = "_timestamps.json";
type Timestamps = Record<string, { first_seen: number; last_changed: number }>;

/** Product-owned data modules, relative to app/(products)/<slug>/. */
const DATA_FILES = ["_store.ts", "_research.ts", "_shipped.ts"];

/**
 * Every file of the product's own that is not a content row: the data modules
 * plus everything under its .claude/ — the build agent and the skills that say
 * which sources it trusts and what its research has covered. Those are the
 * product's doctrine, and a description of a private corpus is as private as
 * the corpus, so they live in its database with a version for every change.
 * `site` has no folder of its own here: the platform's .claude/ at the repo
 * root is the org, and it stays in git.
 */
/**
 * The site's own files: the loop's queue and the memory notes written in the
 * operator's voice. Platform doctrine stays in git (.claude/memory/*.md); these
 * are the records a public repository should not carry, so they live in the
 * site database and pull to disk under a gitignored path.
 */
const SITE_FILES = ["cronjobs/run-state.json"];
const SITE_PRIVATE_DIR = ".claude/memory/private";

function productFiles(slug: string): string[] {
  const dir = productDir(slug);
  const walk = (d: string, into: string[]) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, into);
      else into.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  if (slug === "site") {
    const out = SITE_FILES.filter((rel) => fs.existsSync(path.join(dir, rel)));
    walk(path.join(dir, SITE_PRIVATE_DIR), out);
    return out.sort();
  }
  const out = DATA_FILES.filter((rel) => fs.existsSync(path.join(dir, rel)));
  const own = path.join(dir, ".claude");
  const walkClaude = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walkClaude(full);
      else out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  walkClaude(own);
  return out.sort();
}

async function client(slug: string): Promise<Client> {
  const creds = await productCredentials(slug);
  if (!creds) {
    throw new Error(
      slug === "site"
        ? `${envKey("site", "URL")} is not set — the site database is the registry. Open /setup, or set it by hand.`
        : `no database for ${slug}: not in the registry and ${envKey(slug, "URL")} is not set. Run: pnpm product:db provision ${slug}`,
    );
  }
  return createClient(creds);
}

/** Run the platform DDL, then the product's own if it ships one. */
async function migrate(db: Client, slug: string): Promise<void> {
  await migrateContent(db);

  const own = path.join(productDir(slug), "_schema.sql");
  if (!fs.existsSync(own)) return;
  const sql = fs.readFileSync(own, "utf8");
  // Naive split on `;` at end of line. Enough for CREATE TABLE / CREATE INDEX,
  // which is what a product schema is; a product needing more can run its own
  // migration tool and leave this file out.
  for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
    await db.execute(stmt);
  }
  console.log(`  ran ${slug}/_schema.sql`);
}


// ── drift guard ──────────────────────────────────────────────────────────────
/**
 * The database is the source of truth; the files on disk are a working copy that
 * `pull` overwrites. That is a data-loss trap the first time someone edits a file
 * and forgets to push — the next build silently replaces their work, and nothing
 * says so. It caught me during this migration: four return-type annotations were
 * overwritten by a stale copy from the database.
 *
 * So every sync records a hash of what it wrote, and `pull` compares before it
 * writes. A file that differs from the last recorded sync has local edits that
 * are not in the database, and pull stops rather than destroying them.
 */
const manifestPath = (slug: string) => path.join(ROOT, ".product-db", `${slug}.json`);

function sha(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readManifest(slug: string): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(manifestPath(slug), "utf8")); } catch { return {}; }
}

function writeManifest(slug: string, m: Record<string, string>): void {
  fs.mkdirSync(path.dirname(manifestPath(slug)), { recursive: true });
  fs.writeFileSync(manifestPath(slug), JSON.stringify(m, null, 2) + "\n");
}

/** Every file this product syncs, as repo-relative paths. */
function syncedFiles(slug: string): string[] {
  const out: string[] = [];
  const dir = contentDir(slug);
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(path.relative(ROOT, full));
    }
  };
  walk(dir);
  for (const f of [...productFiles(slug).map((rel) => path.join(productDir(slug), rel)), copyFilePath(slug)]) {
    if (fs.existsSync(f)) out.push(path.relative(ROOT, f));
  }
  return out;
}

function recordSync(slug: string): void {
  const m: Record<string, string> = {};
  for (const rel of syncedFiles(slug)) m[rel] = sha(path.join(ROOT, rel));
  writeManifest(slug, m);
}

/** Files changed on disk since the last sync — i.e. edits the database has not seen. */
function drifted(slug: string): string[] {
  const m = readManifest(slug);
  if (!Object.keys(m).length) return [];
  const out: string[] = [];
  for (const rel of syncedFiles(slug)) {
    const known = m[rel];
    const now = sha(path.join(ROOT, rel));
    if (!known || known !== now) out.push(rel);
  }
  return out;
}

// ── commands ─────────────────────────────────────────────────────────────────

/** `--name x --tagline y` → { name: "x", tagline: "y" }. */
function flags(): Record<string, string> {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const m = /^--([a-z-]+)$/.exec(a[i]!);
    if (m && a[i + 1] && !a[i + 1]!.startsWith("--")) out[m[1]!] = a[++i]!;
  }
  return out;
}

/**
 * A database for the product (Turso API), and a registry row pointing at it.
 * `site` is special: it IS the registry, so its two variables are printed for
 * `.env.local` instead of being stored anywhere.
 */
async function provision(slug: string): Promise<void> {
  const hosted = Boolean(process.env.TURSO_API_TOKEN && process.env.TURSO_ORG);
  const db = hosted ? await ensureDatabase(slug) : { ...localTarget(slug), authToken: undefined };
  console.log(`  ${hosted ? dbName(slug) : db.url} ready (${hosted ? "hosted" : "local"} mode)`);
  if (!hosted && slug === "site") return;
  if (slug === "site") {
    console.log(`\nThe app reaches it through TURSO_API_TOKEN + TURSO_ORG on its own. To name it outright instead:\n`);
    console.log(`${envKey("site", "URL")}=${db.url}`);
    console.log(`${envKey("site", "TOKEN")}=${await groupToken()}`);
    return;
  }
  if (!siteDbConfigured()) throw new Error("the site database is not configured; provision `site` first");
  const f = flags();
  const existing = await fetchProduct(slug);
  const product: Product = existing
    ? publicProduct(existing)
    : {
        slug,
        teamSlug: f.team ?? "growth-labs",
        name: f.name ?? slug,
        tagline: f.tagline ?? "",
        accent: f.accent ?? "#356a4d",
        status: "active",
        visibility: (f.visibility === "public" || f.visibility === "unlisted" ? f.visibility : "private") as Product["visibility"],
        hasResearch: true,
        wishBlock: await nextWishBlock(),
      };
  await upsertTeam({ slug: product.teamSlug, name: f["team-name"] ?? (product.teamSlug === "growth-labs" ? "Growth Labs" : product.teamSlug) });
  // The group token authenticates every database in the group, so the row carries the URL only.
  await upsertProduct({ ...product, dbUrl: db.url });
  await migrateContent(createClient({ url: db.url, authToken: db.authToken }));
  console.log(`  registered ${slug} (${product.name}) → ${db.url}`);
}

/** The history of one product file. */
async function versions(slug: string, rel: string): Promise<void> {
  if (!rel) throw new Error("usage: pnpm product:db versions <slug> <rel_path>   e.g. .claude/skills/research/SKILL.md");
  const rows = await listFileVersions(await client(slug), rel);
  if (!rows.length) {
    console.log(`  no versions of ${rel} in ${slug}`);
    return;
  }
  for (const v of rows) {
    console.log(`  v${String(v.version).padEnd(4)} ${new Date(v.updated_at * 1000).toISOString().slice(0, 16).replace("T", " ")}  ${String(v.bytes).padStart(8)} B${v.current ? "  ← current" : ""}`);
  }
}

/**
 * Put an older version back on disk. It is NOT pushed: read it, and if it is
 * what you want, `push` makes it the next version (history is append-only, so
 * the rollback is itself a version).
 */
async function restore(slug: string, rel: string, version: string): Promise<void> {
  if (!rel || !version) throw new Error("usage: pnpm product:db restore <slug> <rel_path> <version>");
  const body = await readFileVersion(await client(slug), rel, Number(version));
  if (body == null) throw new Error(`no version ${version} of ${rel} in ${slug}`);
  const f = path.join(productDir(slug), rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  console.log(`  wrote v${version} of ${rel} to disk — \`pnpm product:db push ${slug}\` to make it current`);
}

async function list(): Promise<void> {
  if (!siteDbConfigured()) throw new Error(`${envKey("site", "URL")} is not set — no registry`);
  const rows = await fetchProducts();
  if (!rows.length) console.log("  (no products registered)");
  for (const r of rows) console.log(`  ${r.slug.padEnd(12)} ${r.name.padEnd(24)} ${r.dbUrl ? r.dbUrl.replace(/\?.*$/, "") : "(no database)"}`);
}

async function exportCmd(slug: string, file: string): Promise<void> {
  if (!file) throw new Error("usage: pnpm product:db export <slug> <file>");
  const row = await fetchProduct(slug);
  if (!row) throw new Error(`${slug} is not in the registry`);
  const bundle = await exportBundle(await client(slug), publicProduct(row));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(bundle, null, 2) + "\n");
  console.log(`  exported ${slug}: ${bundle.entities.length} entities, ${bundle.ui_copy.length} copy rows, ${bundle.product_files.length} data modules → ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

async function importCmd(slug: string, file: string): Promise<void> {
  if (!file) throw new Error("usage: pnpm product:db import <slug> <file>");
  const bundle = JSON.parse(fs.readFileSync(file, "utf8")) as ProductBundle;
  if (bundle.product.slug !== slug) throw new Error(`bundle is for ${bundle.product.slug}, not ${slug}`);
  if (!(await productCredentials(slug))) await provision(slug);
  await upsertTeam({ slug: bundle.product.teamSlug, name: bundle.product.teamSlug === "growth-labs" ? "Growth Labs" : bundle.product.teamSlug });
  await upsertProduct(bundle.product);
  const c = await importBundle(await client(slug), bundle);
  console.log(`  imported ${slug}: ${c.entities} entities, ${c.substrates} substrates, ${c.documents} documents, ${c.product_files} data modules, ${c.ui_copy} copy rows`);
}

async function push(slug: string): Promise<void> {
  const dir = contentDir(slug);
  const hasContent = fs.existsSync(dir);
  const db = await client(slug);
  await migrate(db, slug);

  let n = 0;
  const entDir = path.join(dir, "entities");
  if (hasContent && fs.existsSync(entDir)) {
    for (const f of fs.readdirSync(entDir).filter((x) => x.endsWith(".json"))) {
      const raw = fs.readFileSync(path.join(entDir, f), "utf8");
      const parsed = JSON.parse(raw) as { slug?: string; depth_score?: number };
      await db.execute({
        // A push that changes nothing leaves updated_at alone: the column is the
        // entity's last real change, not the last time someone ran push.
        sql: `INSERT INTO entities (slug, body, depth_score, first_seen, updated_at)
              VALUES (?, ?, ?, unixepoch(), unixepoch())
              ON CONFLICT(slug) DO UPDATE SET
                body=excluded.body, depth_score=excluded.depth_score, updated_at=unixepoch()
              WHERE body <> excluded.body`,
        args: [parsed.slug ?? f.replace(/\.json$/, ""), raw, parsed.depth_score ?? null],
      });
      n++;
    }
    // A floor on disk can only push dates back, never forward.
    const floorFile = path.join(dir, TIMESTAMPS_FILE);
    if (fs.existsSync(floorFile)) {
      const floor = JSON.parse(fs.readFileSync(floorFile, "utf8")) as Timestamps;
      const stmts = Object.entries(floor).map(([slug, t]) => ({
        sql: `UPDATE entities SET first_seen = ? WHERE slug = ? AND (first_seen IS NULL OR first_seen > ?)`,
        args: [t.first_seen, slug, t.first_seen],
      }));
      for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), "write");
    }
  }

  const edges = path.join(dir, "edges.json");
  if (fs.existsSync(edges)) {
    await db.execute({
      sql: `INSERT INTO edges (id, body, updated_at) VALUES (1, ?, unixepoch())
            ON CONFLICT(id) DO UPDATE SET body=excluded.body, updated_at=unixepoch()`,
      args: [fs.readFileSync(edges, "utf8")],
    });
  }

  let subs = 0;
  // `_`-prefixed files are the sync's own (the timestamps floor), not a substrate.
  for (const f of hasContent ? fs.readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "edges.json" && !x.startsWith("_")) : []) {
    await db.execute({
      sql: `INSERT INTO substrates (kind, body, updated_at) VALUES (?, ?, unixepoch())
            ON CONFLICT(kind) DO UPDATE SET body=excluded.body, updated_at=unixepoch()`,
      args: [f.replace(/\.json$/, ""), fs.readFileSync(path.join(dir, f), "utf8")],
    });
    subs++;
  }

  let docs = 0;
  for (const sub of hasContent ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    if (!sub.isDirectory() || sub.name === "entities") continue;
    for (const f of fs.readdirSync(path.join(dir, sub.name))) {
      const rel = `${sub.name}/${f}`;
      await db.execute({
        sql: `INSERT INTO documents (rel_path, body, updated_at) VALUES (?, ?, unixepoch())
              ON CONFLICT(rel_path) DO UPDATE SET body=excluded.body, updated_at=unixepoch()`,
        args: [rel, fs.readFileSync(path.join(dir, sub.name, f), "utf8")],
      });
      docs++;
    }
  }
  let dataFiles = 0;
  let newVersions = 0;
  const pdir = productDir(slug);
  for (const rel of productFiles(slug)) {
    const r = await putProductFile(db, rel, fs.readFileSync(path.join(pdir, rel), "utf8"));
    dataFiles++;
    if (r.changed) newVersions++;
  }
  const copyRows = await pushCopy(db, slug);
  recordSync(slug);
  console.log(`  pushed ${n} entities, ${fs.existsSync(edges) ? 1 : 0} edge set, ${subs} substrates, ${docs} documents, ${dataFiles} product files (${newVersions} new version${newVersions === 1 ? "" : "s"}), ${copyRows} copy rows`);
}

/**
 * `_copy.json` → `ui_copy`. The file is the whole set, so a row the file no
 * longer has is a string no page renders any more; it is deleted rather than
 * left to shadow a future id.
 */
async function pushCopy(db: Client, slug: string): Promise<number> {
  const f = copyFilePath(slug);
  if (!fs.existsSync(f)) return 0;
  const rows = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, string>;
  const ids = Object.keys(rows);
  const stmts = ids.map((id) => ({
    sql: `INSERT INTO ui_copy (id, value, updated_at) VALUES (?, ?, unixepoch())
          ON CONFLICT(id) DO UPDATE SET value=excluded.value, updated_at=unixepoch()
          WHERE value <> excluded.value`,
    args: [id, String(rows[id])],
  }));
  // libsql batches are one round trip; 500 statements per batch keeps a large
  // product well under the request limit.
  for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), "write");
  const existing = await db.execute("SELECT id FROM ui_copy");
  const stale = existing.rows.map((r) => String(r.id)).filter((id) => !(id in rows));
  if (stale.length) {
    await db.batch(stale.map((id) => ({ sql: "DELETE FROM ui_copy WHERE id = ?", args: [id] })), "write");
    console.log(`  removed ${stale.length} copy row(s) no page names any more`);
  }
  return ids.length;
}

async function pull(slug: string): Promise<void> {
  const force = process.argv.includes("--force");
  const dirty = drifted(slug);
  if (dirty.length && !force) {
    throw new Error(
      `${slug}: ${dirty.length} file(s) changed on disk since the last sync and are not in the database:\n` +
      dirty.slice(0, 8).map((f) => `    ${f}`).join("\n") +
      (dirty.length > 8 ? `\n    … and ${dirty.length - 8} more` : "") +
      `\n\n  Pulling would overwrite them. Either:\n` +
      `    pnpm product:db push ${slug}     keep the local edits\n` +
      `    pnpm product:db pull ${slug} --force   discard them`,
    );
  }
  const db = await client(slug);
  const dir = contentDir(slug);
  // A database created before a column existed must still pull. The DDL is
  // idempotent, so running it here costs one round trip and removes a whole
  // class of "works after push, fails on a fresh build" surprises.
  await migrate(db, slug);

  const ents = await db.execute("SELECT slug, body, first_seen, updated_at FROM entities ORDER BY slug");
  if (ents.rows.length) fs.mkdirSync(path.join(dir, "entities"), { recursive: true });
  const stamps: Timestamps = {};
  for (const r of ents.rows) {
    fs.writeFileSync(path.join(dir, "entities", `${r.slug as string}.json`), r.body as string);
    stamps[r.slug as string] = {
      first_seen: Number(r.first_seen ?? r.updated_at),
      last_changed: Number(r.updated_at),
    };
  }
  if (ents.rows.length) fs.writeFileSync(path.join(dir, TIMESTAMPS_FILE), JSON.stringify(stamps, null, 2) + "\n");

  const e = await db.execute("SELECT body FROM edges WHERE id = 1");
  if (e.rows[0]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "edges.json"), e.rows[0].body as string);
  }

  const subs = await db.execute("SELECT kind, body FROM substrates");
  for (const r of subs.rows) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${r.kind as string}.json`), r.body as string);
  }

  const docs = await db.execute("SELECT rel_path, body FROM documents");
  for (const r of docs.rows) {
    const p = path.join(dir, r.rel_path as string);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, r.body as string);
  }
  let files = 0;
  try {
    const pf = await db.execute("SELECT rel_path, body FROM product_files");
    for (const r of pf.rows) {
      const f = path.join(productDir(slug), r.rel_path as string);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, r.body as string);
      files++;
    }
  } catch { /* table predates this feature */ }
  let copyRows = 0;
  try {
    const cr = await db.execute("SELECT id, value FROM ui_copy ORDER BY id");
    if (cr.rows.length) {
      const out: Record<string, string> = {};
      for (const r of cr.rows) out[String(r.id)] = String(r.value);
      fs.writeFileSync(copyFilePath(slug), JSON.stringify(out, null, 2) + "\n");
      copyRows = cr.rows.length;
    }
  } catch { /* table predates this feature */ }
  recordSync(slug);
  console.log(`  pulled ${ents.rows.length} entities, ${e.rows.length} edge set, ${subs.rows.length} substrates, ${docs.rows.length} documents, ${files} product files, ${copyRows} copy rows → ${slug}`);
}

async function status(slug: string): Promise<void> {
  const db = await client(slug);
  for (const t of ["entities", "edges", "substrates", "documents", "product_files", "product_files_versions", "ui_copy"]) {
    try {
      const r = await db.execute(`SELECT count(*) n FROM ${t}`);
      console.log(`  ${t.padEnd(12)} ${r.rows[0].n}`);
    } catch {
      console.log(`  ${t.padEnd(12)} (missing)`);
    }
  }
}


/**
 * Make sure every data module exists, falling back to its committed stub.
 *
 * `_store.ts` and friends are imported, so the compiler needs them present even
 * when there is no database to pull them from. Each product commits a
 * content-free `_store.stub.ts`; this copies it into place only when the real
 * file is absent, so a checkout with credentials keeps the real data and one
 * without still builds.
 */
function stubs(slug: string): void {
  const dir = productDir(slug);
  let n = 0;
  for (const rel of DATA_FILES) {
    const real = path.join(dir, rel);
    const stub = real.replace(/\.ts$/, ".stub.ts");
    if (fs.existsSync(real) || !fs.existsSync(stub)) continue;
    fs.copyFileSync(stub, real);
    n++;
  }
  if (n) console.log(`  ${slug}: ${n} module(s) filled from stubs — no data`);
}

// ── entry ────────────────────────────────────────────────────────────────────

const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && /^--[a-z-]+$/.test(all[i - 1]!) && !["--all", "--force"].includes(all[i - 1]!)));
const [cmd, slug, file] = positional;
const all = process.argv.includes("--all");
if (!cmd || (!slug && !all && cmd !== "list")) {
  console.error("usage: pnpm product:db <provision|list|push|pull|stubs|status|export|import|versions|restore> <slug>|--all [file] [version]");
  process.exit(1);
}

/** Every registered product, plus the site itself. Without a registry: just the site, and say so. */
async function everyScope(): Promise<string[]> {
  if (!siteDbConfigured()) {
    console.log(`  ${envKey("site", "URL")} is not set — no registry to read; nothing pulled. Open /setup.`);
    return [];
  }
  const rows = await fetchProducts();
  return [...rows.map((r) => r.slug), "site"];
}

/** Every product folder that ships stubs. */
function everyFolder(): string[] {
  const dir = path.join(ROOT, "app", "(products)");
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith("[")).map((e) => e.name);
}

const run = async () => {
  if (cmd === "provision") return provision(slug!);
  if (cmd === "list") return list();
  if (cmd === "push") return push(slug!);
  if (cmd === "pull") {
    if (!all) return pull(slug!);
    for (const s of await everyScope()) {
      try {
        await pull(s);
      } catch (err) {
        console.log(`  ${s}: ${(err as Error).message.split("\n")[0]}`);
      }
    }
    return;
  }
  if (cmd === "status") return status(slug!);
  if (cmd === "stubs") {
    for (const s of all ? everyFolder() : [slug!]) stubs(s);
    return;
  }
  if (cmd === "versions") return versions(slug!, file!);
  if (cmd === "restore") return restore(slug!, file!, positional[3]!);
  if (cmd === "export") return exportCmd(slug!, file!);
  if (cmd === "import") return importCmd(slug!, file!);
  throw new Error(`unknown command: ${cmd}`);
};

run().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}`);
  process.exit(1);
});
