/**
 * A product's content database: the schema, and a product as one portable
 * bundle.
 *
 * The schema is the platform's half of every product database (entities,
 * edges, substrates, documents, data modules, UI copy). It used to live only in
 * scripts/product-db.ts; it is here so the app can create a product's database
 * from /setup with the same DDL the script uses.
 *
 * A BUNDLE is every row of one product in a single JSON document. `demo/` in
 * the repository holds one for the demo product, so a fresh install can load a
 * working product without cloning anyone's corpus into git a row at a time.
 * The same shape is what `product:db export` writes and `import` reads.
 *
 * Plain module: used from Next server code and from tsx scripts.
 */
import type { Client, InStatement } from "@libsql/client";
import type { Product } from "./registry/core";

export const CONTENT_DDL = [
  // first_seen / updated_at are the entity's age; they live here because the
  // entity lives here — git no longer holds the file, so git cannot date it.
  `CREATE TABLE IF NOT EXISTS entities (
     slug        TEXT PRIMARY KEY,
     body        TEXT NOT NULL,
     depth_score INTEGER,
     first_seen  INTEGER,
     updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE INDEX IF NOT EXISTS entities_depth_idx ON entities (depth_score)`,
  // One row. The edge graph is read whole and rewritten whole.
  `CREATE TABLE IF NOT EXISTS edges (
     id         INTEGER PRIMARY KEY CHECK (id = 1),
     body       TEXT NOT NULL,
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  // voices / benchmarks / incidents / architecture / any future sibling file.
  `CREATE TABLE IF NOT EXISTS substrates (
     kind       TEXT PRIMARY KEY,
     body       TEXT NOT NULL,
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  // Nested content directories (sharing/, reports/) keyed by their path.
  `CREATE TABLE IF NOT EXISTS documents (
     rel_path   TEXT PRIMARY KEY,
     body       TEXT NOT NULL,
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  // The product's own files that are not content rows: its data modules
  // (_store.ts, _research.ts, _shipped.ts) and everything under its .claude/ —
  // the build agent and the skills that name the sources it trusts and the
  // frontier it has covered. Source text, written back verbatim before a build.
  `CREATE TABLE IF NOT EXISTS product_files (
     rel_path   TEXT PRIMARY KEY,
     body       TEXT NOT NULL,
     version    INTEGER NOT NULL DEFAULT 1,
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  // Every version a file has had. A push that changes a file's body writes the
  // new body here under the next version number and moves product_files to it;
  // a push that changes nothing writes nothing. Doctrine has a history, so a
  // skill rewritten badly can be read as it was.
  `CREATE TABLE IF NOT EXISTS product_files_versions (
     rel_path   TEXT NOT NULL,
     version    INTEGER NOT NULL,
     body       TEXT NOT NULL,
     updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
     PRIMARY KEY (rel_path, version)
   )`,
  // The product's wishes and their threads (app/_platform/wishes/db.ts owns the
  // reads and writes; the schema is here so a database made by /setup has them).
  `CREATE TABLE IF NOT EXISTS wishes (
     id            INTEGER PRIMARY KEY,
     scope         TEXT    NOT NULL,
     title         TEXT    NOT NULL,
     body          TEXT    NOT NULL DEFAULT '',
     stage         TEXT    NOT NULL DEFAULT 'triage',
     role          TEXT    NOT NULL DEFAULT 'PM',
     nickname      TEXT    NOT NULL DEFAULT 'guest',
     source        TEXT    NOT NULL DEFAULT 'form',
     votes         INTEGER NOT NULL DEFAULT 1,
     priority      TEXT,
     parent_id     INTEGER,
     blocked_by    INTEGER,
     origin_scope  TEXT,
     public_wish   INTEGER NOT NULL DEFAULT 0,
     followups     INTEGER NOT NULL DEFAULT 0,
     media         TEXT    NOT NULL DEFAULT '[]',
     legacy_issue  INTEGER,
     created_at    TEXT    NOT NULL,
     closed_at     TEXT,
     claimed_by    TEXT,
     claim_expires_at INTEGER,
     updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
  `CREATE INDEX IF NOT EXISTS wishes_stage_idx  ON wishes (stage)`,
  `CREATE INDEX IF NOT EXISTS wishes_scope_idx  ON wishes (scope)`,
  `CREATE INDEX IF NOT EXISTS wishes_parent_idx ON wishes (parent_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wishes_legacy_issue_unique ON wishes (legacy_issue)`,

  // The thread. Kept as rows rather than a JSON blob on the wish because a
  // comment is appended far more often than a wish is edited, and because the
  // receipt page reads them in time order.
  `CREATE TABLE IF NOT EXISTS wish_comments (
     id       INTEGER PRIMARY KEY AUTOINCREMENT,
     wish_id  INTEGER NOT NULL,
     kind     TEXT    NOT NULL DEFAULT 'note',
     body     TEXT    NOT NULL,
     author   TEXT,
     at       TEXT    NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS wish_comments_wish_idx ON wish_comments (wish_id, at)`,
  // Every reader-visible string on the product's pages, keyed by content id.
  `CREATE TABLE IF NOT EXISTS ui_copy (
     id         TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,
];

/** Columns added after a table first shipped. SQLite has no ADD COLUMN IF NOT EXISTS. */
const CONTENT_ALTERS = [
  `ALTER TABLE entities ADD COLUMN first_seen INTEGER`,
  `ALTER TABLE product_files ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
];

/** Idempotent. */
export async function migrateContent(db: Client): Promise<void> {
  for (const s of CONTENT_DDL) await db.execute(s);
  for (const s of CONTENT_ALTERS) {
    try {
      await db.execute(s);
    } catch (err) {
      if (!/duplicate column/i.test((err as Error).message)) throw err;
    }
  }
  // Files that predate the history table start it at their current version, so
  // a product's first recorded version is what it had, not what it changed to.
  await db.execute(
    "INSERT OR IGNORE INTO product_files_versions (rel_path, version, body, updated_at) SELECT rel_path, version, body, updated_at FROM product_files",
  );
}

/**
 * Write one product file, keeping its history: unchanged → nothing; changed
 * (or new) → the next version, recorded in product_files_versions and made
 * current. Returns the version now current and whether anything was written.
 */
export async function putProductFile(db: Client, relPath: string, body: string): Promise<{ version: number; changed: boolean }> {
  const cur = await db.execute({ sql: "SELECT body, version FROM product_files WHERE rel_path = ?", args: [relPath] });
  const row = cur.rows[0];
  if (row && String(row.body) === body) return { version: Number(row.version ?? 1), changed: false };
  const version = row ? Number(row.version ?? 1) + 1 : 1;
  await db.batch(
    [
      {
        sql: `INSERT INTO product_files (rel_path, body, version, updated_at) VALUES (?, ?, ?, unixepoch())
              ON CONFLICT(rel_path) DO UPDATE SET body = excluded.body, version = excluded.version, updated_at = unixepoch()`,
        args: [relPath, body, version],
      },
      {
        sql: `INSERT INTO product_files_versions (rel_path, version, body, updated_at) VALUES (?, ?, ?, unixepoch())
              ON CONFLICT(rel_path, version) DO UPDATE SET body = excluded.body, updated_at = unixepoch()`,
        args: [relPath, version, body],
      },
    ],
    "write",
  );
  return { version, changed: true };
}

export type FileVersion = { version: number; updated_at: number; bytes: number; current: boolean };

/** Every version of one file, newest first. */
export async function listFileVersions(db: Client, relPath: string): Promise<FileVersion[]> {
  const cur = await db.execute({ sql: "SELECT version FROM product_files WHERE rel_path = ?", args: [relPath] });
  const current = Number(cur.rows[0]?.version ?? 0);
  const rs = await db.execute({
    sql: "SELECT version, updated_at, length(cast(body as blob)) AS bytes FROM product_files_versions WHERE rel_path = ? ORDER BY version DESC",
    args: [relPath],
  });
  return rs.rows.map((r) => ({ version: Number(r.version), updated_at: Number(r.updated_at), bytes: Number(r.bytes), current: Number(r.version) === current }));
}

export async function readFileVersion(db: Client, relPath: string, version: number): Promise<string | null> {
  const rs = await db.execute({ sql: "SELECT body FROM product_files_versions WHERE rel_path = ? AND version = ?", args: [relPath, version] });
  return rs.rows[0] ? String(rs.rows[0].body) : null;
}

export type ProductBundle = {
  version: 1;
  exportedAt: string;
  product: Product;
  entities: { slug: string; body: string; depth_score: number | null; first_seen: number | null; updated_at: number }[];
  edges: string | null;
  substrates: { kind: string; body: string }[];
  documents: { rel_path: string; body: string }[];
  product_files: { rel_path: string; body: string }[];
  ui_copy: { id: string; value: string }[];
};

export type BundleCounts = { entities: number; substrates: number; documents: number; product_files: number; ui_copy: number; edges: 0 | 1 };

const str = (v: unknown) => (v == null ? null : String(v));

export async function exportBundle(db: Client, product: Product): Promise<ProductBundle> {
  await migrateContent(db);
  const [ents, edges, subs, docs, files, copy] = await Promise.all([
    db.execute("SELECT slug, body, depth_score, first_seen, updated_at FROM entities ORDER BY slug"),
    db.execute("SELECT body FROM edges WHERE id = 1"),
    db.execute("SELECT kind, body FROM substrates ORDER BY kind"),
    db.execute("SELECT rel_path, body FROM documents ORDER BY rel_path"),
    db.execute("SELECT rel_path, body FROM product_files ORDER BY rel_path"),
    db.execute("SELECT id, value FROM ui_copy ORDER BY id"),
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    product,
    entities: ents.rows.map((r) => ({
      slug: String(r.slug),
      body: String(r.body),
      depth_score: r.depth_score == null ? null : Number(r.depth_score),
      first_seen: r.first_seen == null ? null : Number(r.first_seen),
      updated_at: Number(r.updated_at),
    })),
    edges: str(edges.rows[0]?.body),
    substrates: subs.rows.map((r) => ({ kind: String(r.kind), body: String(r.body) })),
    documents: docs.rows.map((r) => ({ rel_path: String(r.rel_path), body: String(r.body) })),
    product_files: files.rows.map((r) => ({ rel_path: String(r.rel_path), body: String(r.body) })),
    ui_copy: copy.rows.map((r) => ({ id: String(r.id), value: String(r.value) })),
  };
}

async function batched(db: Client, stmts: InStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += 200) await db.batch(stmts.slice(i, i + 200), "write");
}

/**
 * Write a bundle into a database. Rows are upserted, so importing over an
 * existing product refreshes it; an entity's first_seen is kept if the target
 * already has an earlier one.
 */
export async function importBundle(db: Client, b: ProductBundle): Promise<BundleCounts> {
  if (b.version !== 1) throw new Error(`unknown bundle version ${String((b as { version: unknown }).version)}`);
  await migrateContent(db);
  await batched(
    db,
    b.entities.map((e) => ({
      sql: `INSERT INTO entities (slug, body, depth_score, first_seen, updated_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
              body = excluded.body, depth_score = excluded.depth_score,
              first_seen = MIN(COALESCE(entities.first_seen, excluded.first_seen), COALESCE(excluded.first_seen, entities.first_seen)),
              updated_at = excluded.updated_at`,
      args: [e.slug, e.body, e.depth_score, e.first_seen, e.updated_at],
    })),
  );
  if (b.edges != null) {
    await db.execute({
      sql: `INSERT INTO edges (id, body, updated_at) VALUES (1, ?, unixepoch()) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = unixepoch()`,
      args: [b.edges],
    });
  }
  await batched(db, b.substrates.map((s) => ({ sql: `INSERT INTO substrates (kind, body, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(kind) DO UPDATE SET body = excluded.body, updated_at = unixepoch()`, args: [s.kind, s.body] })));
  await batched(db, b.documents.map((d) => ({ sql: `INSERT INTO documents (rel_path, body, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(rel_path) DO UPDATE SET body = excluded.body, updated_at = unixepoch()`, args: [d.rel_path, d.body] })));
  // Through putProductFile so an import is a version like any other change.
  for (const f of b.product_files) await putProductFile(db, f.rel_path, f.body);
  await batched(db, b.ui_copy.map((c) => ({ sql: `INSERT INTO ui_copy (id, value, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`, args: [c.id, c.value] })));
  return {
    entities: b.entities.length,
    edges: b.edges != null ? 1 : 0,
    substrates: b.substrates.length,
    documents: b.documents.length,
    product_files: b.product_files.length,
    ui_copy: b.ui_copy.length,
  };
}
