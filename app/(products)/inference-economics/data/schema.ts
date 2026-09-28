/**
 * The game's tables, as the product declares them. Applied on first touch by
 * app/_platform/productData.ts (idempotent), so they exist wherever the
 * product runs — a fresh SQLite file, a Turso database created by /setup.
 *
 * Two kinds of table. REFERENCE tables hold the game's world: hardware
 * generations, the seven years, the tech tree, power plans, training cards,
 * architectures, research, and the glossary. They are filled once from
 * data/seed.json when found empty (see ../_db.ts) and read by the game at
 * start. PLAYER tables hold what people do: a save per account per business
 * line, and every finished run for the leaderboard.
 *
 * `data/schema.sql` is the same declaration as plain SQL, regenerated from
 * this file by `pnpm game:embed`, for reading and for tools that speak SQL.
 *
 * Plain module (no server-only) so scripts and tests can import it.
 */

export const GAME_SLUG = "inference-economics";

/** column ↔ game field. kind decides how a value crosses the boundary. */
export type Col = [field: string, column: string, kind: "text" | "num" | "json" | "bool", sqlType?: string];

export type Table = { name: string; key: string; cols: Col[]; seed: string };

/** Reference tables. `seed` names the dataset in data/seed.json. */
export const REFERENCE: Table[] = [
  { name: "ie_hardware", key: "key", seed: "hardware", cols: [
    ["k", "key", "text", "TEXT PRIMARY KEY"], ["n", "name", "text"], ["from", "from_year", "num", "INTEGER"],
    ["bw", "bw", "num"], ["f16", "f16", "num"], ["f8", "f8", "num"], ["f4", "f4", "num"],
    ["spec", "spec", "json"], ["u", "unit", "json"], ["st", "stacks", "num", "INTEGER"], ["cap", "cap", "num"],
    ["kw", "kw", "num"], ["px", "px", "num"], ["nvl", "nvlink", "bool"], ["note", "note", "text"],
  ] },
  { name: "ie_years", key: "year", seed: "years", cols: [
    ["y", "year", "num", "INTEGER PRIMARY KEY"], ["era", "era", "text"], ["tag", "tag", "text"],
    ["P", "params", "num"], ["kvKB", "kv_kb", "num"], ["L", "ctx", "num", "INTEGER"], ["demand", "demand", "num"],
    ["maxB", "max_b", "num", "INTEGER"], ["price", "price", "num"], ["brief", "brief", "json"], ["rec", "rec", "json"], ["evt", "evt", "json"],
  ] },
  { name: "ie_tech", key: "key", seed: "tech", cols: [
    ["k", "key", "text", "TEXT PRIMARY KEY"], ["n", "name", "text"], ["cost", "cost", "num", "INTEGER"],
    ["from", "from_year", "num", "INTEGER"], ["req", "req", "text"], ["trap", "trap", "bool"], ["desc", "descr", "text"],
  ] },
  { name: "ie_power", key: "key", seed: "power", cols: [
    ["k", "key", "text", "TEXT PRIMARY KEY"], ["n", "name", "text"], ["mw", "mw", "num"], ["px", "px", "num"],
    ["lead", "lead_years", "num", "INTEGER"], ["ferc", "ferc", "bool"], ["desc", "descr", "text"],
  ] },
  { name: "ie_train_cards", key: "key", seed: "train_cards", cols: [
    ["k", "key", "text", "TEXT PRIMARY KEY"], ["n", "name", "text"], ["from", "from_year", "num", "INTEGER"], ["to", "to_year", "num", "INTEGER"],
    ["f16", "f16", "num"], ["f8", "f8", "num"], ["bw", "bw", "num"], ["cap", "cap", "num"], ["kw", "kw", "num"], ["px", "px", "num"],
    ["rent", "rent", "num"], ["nvl", "nvl_domain", "num", "INTEGER"], ["nvlbw", "nvl_bw", "num", "INTEGER"], ["ban", "ban", "json"], ["note", "note", "text"],
  ] },
  { name: "ie_fabrics", key: "key", seed: "fabrics", cols: [
    ["k", "key", "text", "TEXT PRIMARY KEY"], ["n", "name", "text"], ["bw", "bw", "num", "INTEGER"], ["px", "px", "num"], ["note", "note", "text"],
  ] },
  { name: "ie_archs", key: "key", seed: "archs", cols: [
    ["k", "key", "text", "TEXT PRIMARY KEY"], ["n", "name", "text"], ["act", "act", "num"], ["mfu", "mfu", "num"], ["req", "req", "text"], ["desc", "descr", "text"],
  ] },
  { name: "ie_attentions", key: "key", seed: "attentions", cols: [
    ["k", "key", "text", "TEXT PRIMARY KEY"], ["n", "name", "text"], ["kv", "kv", "num"], ["req", "req", "text"], ["desc", "descr", "text"],
  ] },
  { name: "ie_recomputes", key: "key", seed: "recomputes", cols: [
    ["k", "key", "text", "TEXT PRIMARY KEY"], ["n", "name", "text"], ["tax", "tax", "num"], ["act", "act", "num"], ["desc", "descr", "text"],
  ] },
  { name: "ie_data_tiers", key: "key", seed: "data_tiers", cols: [
    ["k", "key", "text", "TEXT PRIMARY KEY"], ["n", "name", "text"], ["q", "q", "num"], ["px", "px", "num"], ["eng", "eng", "num", "INTEGER"],
    ["req", "req", "text"], ["risk", "risk", "num"], ["desc", "descr", "text"],
  ] },
  { name: "ie_research", key: "key", seed: "research", cols: [
    ["k", "key", "text", "TEXT PRIMARY KEY"], ["n", "name", "text"], ["cost", "cost", "num", "INTEGER"], ["from", "from_year", "num", "INTEGER"],
    ["req", "req", "text"], ["desc", "descr", "text"],
  ] },
  { name: "ie_pretrain_years", key: "year", seed: "pretrain_years", cols: [
    ["y", "year", "num", "INTEGER PRIMARY KEY"], ["tag", "tag", "text"], ["hqName", "hq_name", "text"], ["dataCap", "data_cap", "num"],
    ["market", "market", "num"], ["fronL", "fron_l", "num"], ["fronRef", "fron_ref", "text"], ["comp", "comp", "num"], ["refPrice", "ref_price", "num"],
    ["seed", "seed", "num"], ["brief", "brief", "json"], ["rec", "rec", "json"], ["evt", "evt", "json"],
  ] },
];

const sqlType = (c: Col) => c[3] ?? (c[2] === "num" ? "REAL" : c[2] === "bool" ? "INTEGER" : "TEXT");

/** Every statement, re-runnable. */
export const DDL: string[] = [
  ...REFERENCE.map((t) => `CREATE TABLE IF NOT EXISTS ${t.name} (\n  ${t.cols.map((c) => `${c[1]} ${sqlType(c)}`).join(",\n  ")}\n)`),
  `CREATE TABLE IF NOT EXISTS ie_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS ie_terms (
  line TEXT NOT NULL,
  term TEXT NOT NULL,
  tip TEXT NOT NULL,
  PRIMARY KEY (line, term)
)`,
  `CREATE TABLE IF NOT EXISTS ie_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS ie_saves (
  account TEXT NOT NULL,
  line TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account, line)
)`,
  `CREATE TABLE IF NOT EXISTS ie_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  display TEXT NOT NULL,
  line TEXT NOT NULL,
  rank TEXT NOT NULL,
  score REAL NOT NULL,
  summary TEXT NOT NULL,
  finished_at INTEGER NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS ie_runs_line_score ON ie_runs (line, score DESC)`,
];

/** The declaration as one SQL file. */
export const SCHEMA_SQL = `-- Inference Economics — the product's tables.\n-- Generated from data/schema.ts by \`pnpm game:embed\`; edit that file, not this one.\n\n${DDL.map((s) => s + ";").join("\n\n")}\n`;

// ── rows ↔ game objects ──────────────────────────────────────────────────────

export type Row = Record<string, unknown>;

/** A game object → a database row (seed.json holds game objects). */
export function toRow(t: Table, obj: Row): Row {
  const out: Row = {};
  for (const [field, column, kind] of t.cols) {
    const v = obj[field];
    if (v === undefined || v === null) { out[column] = null; continue; }
    out[column] = kind === "json" ? JSON.stringify(v) : kind === "bool" ? (v ? 1 : 0) : v;
  }
  return out;
}

/** A database row → the object the game code expects. Nulls are dropped. */
export function fromRow(t: Table, row: Row): Row {
  const out: Row = {};
  for (const [field, column, kind] of t.cols) {
    const v = row[column];
    if (v === undefined || v === null) continue;
    out[field] = kind === "json" ? JSON.parse(String(v)) : kind === "bool" ? Boolean(v) : kind === "num" ? Number(v) : String(v);
  }
  return out;
}
