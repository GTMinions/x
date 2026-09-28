/**
 * Inference Economics — the product's data layer.
 *
 * Everything the game keeps lives in this product's own database:
 *   - the world (reference tables), filled from data/seed.json the first time
 *     the tables are found empty — that file is how a fresh site bootstraps
 *     the product;
 *   - one save per account per business line;
 *   - every finished run, for the leaderboard.
 *
 * Tables are declared in data/schema.ts and created on first touch through
 * app/_platform/productData.ts, so nothing here needs a migration step.
 */
import "server-only";
import type { Client, InValue } from "@libsql/client";

import { withProductData } from "@/app/_platform/productData";
import { DDL, GAME_SLUG, REFERENCE, fromRow, toRow, type Row } from "./data/schema";
import seed from "./data/seed.json";

export type Line = "bu1" | "bu2";
export const LINES: Line[] = ["bu1", "bu2"];

/** Run `fn` against the product's database, tables guaranteed. Null when the product has no database. */
export function withGame<T>(fn: (db: Client) => Promise<T>): Promise<T | null> {
  return withProductData(GAME_SLUG, DDL, fn);
}

// ── bootstrap ────────────────────────────────────────────────────────────────

let seeded = false;

/** Fill the reference tables from the seed when they are empty. Idempotent, once per process. */
export async function ensureSeeded(db: Client): Promise<void> {
  if (seeded) return;
  const n = Number((await db.execute("SELECT COUNT(*) AS n FROM ie_hardware")).rows[0]?.n ?? 0);
  if (n > 0) { seeded = true; return; }

  const stmts: { sql: string; args: InValue[] }[] = [];
  const s = seed as unknown as Record<string, unknown>;
  for (const t of REFERENCE) {
    const objs = s[t.seed] as Row[];
    const columns = t.cols.map((c) => c[1]);
    for (const obj of objs) {
      const row = toRow(t, obj);
      stmts.push({
        sql: `INSERT OR REPLACE INTO ${t.name} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        args: columns.map((c) => row[c] as InValue),
      });
    }
  }
  for (const [year, list] of Object.entries(s.milestones as Record<string, [string, string][]>)) {
    for (const [name, note] of list) stmts.push({ sql: "INSERT INTO ie_milestones (year, name, note) VALUES (?, ?, ?)", args: [Number(year), name, note] });
  }
  for (const [line, terms] of Object.entries(s.terms as Record<string, Record<string, string>>)) {
    for (const [term, tip] of Object.entries(terms)) stmts.push({ sql: "INSERT OR REPLACE INTO ie_terms (line, term, tip) VALUES (?, ?, ?)", args: [line, term, tip] });
  }
  for (const [key, value] of Object.entries(s.config as Record<string, unknown>)) {
    stmts.push({ sql: "INSERT OR REPLACE INTO ie_config (key, value) VALUES (?, ?)", args: [key, JSON.stringify(value)] });
  }
  await db.batch(stmts, "write");
  seeded = true;
}

// ── the world, in the shape the game code reads ──────────────────────────────

export type GameData = {
  hardware: Row[]; years: Row[]; tech: Row[]; power: Row[];
  train_cards: Row[]; fabrics: Row[]; archs: Row[]; attentions: Row[]; recomputes: Row[]; data_tiers: Row[]; research: Row[];
  pretrain_years: Row[];
  milestones: Record<string, [string, string][]>;
  terms: Record<string, Record<string, string>>;
  config: Record<string, unknown>;
};

let cache: { at: number; data: GameData } | null = null;
const TTL_MS = 60_000;

export async function loadGameData(): Promise<GameData | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = await withGame(async (db) => {
    await ensureSeeded(db);
    const out: Partial<GameData> = {};
    for (const t of REFERENCE) {
      const r = await db.execute(`SELECT * FROM ${t.name} ORDER BY rowid`);
      (out as Record<string, unknown>)[t.seed] = r.rows.map((row) => fromRow(t, row as unknown as Row));
    }
    const mil = await db.execute("SELECT year, name, note FROM ie_milestones ORDER BY id");
    out.milestones = {};
    for (const r of mil.rows) (out.milestones[String(r.year)] ??= []).push([String(r.name), String(r.note)]);
    const terms = await db.execute("SELECT line, term, tip FROM ie_terms ORDER BY rowid");
    out.terms = {};
    for (const r of terms.rows) (out.terms[String(r.line)] ??= {})[String(r.term)] = String(r.tip);
    const cfg = await db.execute("SELECT key, value FROM ie_config");
    out.config = {};
    for (const r of cfg.rows) out.config[String(r.key)] = JSON.parse(String(r.value));
    return out as GameData;
  });
  if (data) cache = { at: Date.now(), data };
  return data;
}

// ── saves ────────────────────────────────────────────────────────────────────

export type Save = { line: Line; state: string; updatedAt: number };

export async function listSaves(account: string): Promise<Save[] | null> {
  return withGame(async (db) => {
    const r = await db.execute({ sql: "SELECT line, state, updated_at FROM ie_saves WHERE account = ?", args: [account] });
    return r.rows.map((x) => ({ line: String(x.line) as Line, state: String(x.state), updatedAt: Number(x.updated_at) }));
  });
}

/** The save is the game's own JSON, stored as given; the game validates it on load. */
export async function putSave(account: string, line: Line, state: string): Promise<boolean> {
  const r = await withGame(async (db) => {
    await db.execute({
      sql: `INSERT INTO ie_saves (account, line, state, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(account, line) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      args: [account, line, state, Math.floor(Date.now() / 1000)],
    });
    return true;
  });
  return r === true;
}

export async function deleteSave(account: string, line: Line): Promise<boolean> {
  const r = await withGame(async (db) => {
    await db.execute({ sql: "DELETE FROM ie_saves WHERE account = ? AND line = ?", args: [account, line] });
    return true;
  });
  return r === true;
}

// ── runs ─────────────────────────────────────────────────────────────────────

export type Run = { id: number; display: string; line: Line; rank: string; score: number; summary: Record<string, unknown>; finishedAt: number };

export async function recordRun(input: { account: string; display: string; line: Line; rank: string; score: number; summary: Record<string, unknown> }): Promise<boolean> {
  const r = await withGame(async (db) => {
    await db.execute({
      sql: "INSERT INTO ie_runs (account, display, line, rank, score, summary, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [input.account, input.display, input.line, input.rank, input.score, JSON.stringify(input.summary), Math.floor(Date.now() / 1000)],
    });
    return true;
  });
  return r === true;
}

/** The best runs per line, for the page. */
export async function topRuns(limit = 10): Promise<Record<Line, Run[]>> {
  const out: Record<Line, Run[]> = { bu1: [], bu2: [] };
  const rows = await withGame(async (db) => {
    const all: Run[] = [];
    for (const line of LINES) {
      const r = await db.execute({ sql: "SELECT id, display, line, rank, score, summary, finished_at FROM ie_runs WHERE line = ? ORDER BY score DESC, finished_at ASC LIMIT ?", args: [line, limit] });
      for (const x of r.rows) all.push({ id: Number(x.id), display: String(x.display), line: String(x.line) as Line, rank: String(x.rank), score: Number(x.score), summary: JSON.parse(String(x.summary)), finishedAt: Number(x.finished_at) });
    }
    return all;
  });
  for (const r of rows ?? []) out[r.line].push(r);
  return out;
}
