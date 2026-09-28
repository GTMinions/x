/**
 * Product-owned tables, created on the fly.
 *
 * Two properties carry this: a product's declaration must be enough to make its
 * tables exist (no migration step to forget), and a product must not be able to
 * name a platform table in its DDL — the wish board lives in the same database,
 * and "my feature needs a table" must never be able to become "my feature
 * rewrote the board".
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `x-test-pdata-${process.pid}.db`);
process.env.PRODUCT_DB_SITE_URL = `file:${DB}`;

let pd: typeof import("../app/_platform/productData");

beforeAll(async () => {
  pd = await import("../app/_platform/productData");
  return () => rmSync(DB, { force: true });
});

describe("creating tables from a declaration", () => {
  it("makes the table exist and answers queries in one call", async () => {
    const rows = await pd.withProductData(
      "site",
      [
        `CREATE TABLE IF NOT EXISTS demo_scores (name TEXT PRIMARY KEY, score INTEGER NOT NULL DEFAULT 0)`,
        `CREATE INDEX IF NOT EXISTS demo_scores_score ON demo_scores (score)`,
      ],
      async (db) => {
        await db.execute({ sql: "INSERT OR REPLACE INTO demo_scores (name, score) VALUES (?, ?)", args: ["a", 7] });
        return (await db.execute("SELECT score FROM demo_scores WHERE name = 'a'")).rows;
      },
    );
    expect(Number((rows?.[0] as { score?: unknown })?.score)).toBe(7);
  });

  it("is idempotent — the second call re-runs nothing and still works", async () => {
    const ddl = [`CREATE TABLE IF NOT EXISTS demo_notes (id INTEGER PRIMARY KEY, body TEXT)`];
    await pd.withProductData("site", ddl, async (db) => db.execute("INSERT INTO demo_notes (body) VALUES ('x')"));
    const n = await pd.withProductData("site", ddl, async (db) =>
      Number((await db.execute("SELECT COUNT(*) AS n FROM demo_notes")).rows[0]!.n),
    );
    expect(n).toBe(1);
  });

  it("tolerates ADD COLUMN that already ran — the second deploy is not an error", async () => {
    const v1 = [`CREATE TABLE IF NOT EXISTS demo_widgets (id INTEGER PRIMARY KEY)`];
    await pd.withProductData("site", v1, async () => 0);
    const v2 = [...v1, `ALTER TABLE demo_widgets ADD COLUMN label TEXT`];
    // First time the column is new; run twice with fresh keys by re-declaring.
    await pd.withProductData("site", v2, async () => 0);
    const ok = await pd.withProductData("site", [...v2, `CREATE INDEX IF NOT EXISTS demo_widgets_label ON demo_widgets (label)`], async (db) =>
      (await db.execute("SELECT label FROM demo_widgets LIMIT 0")) !== null,
    );
    expect(ok).toBe(true);
  });
});

describe("the reserved names", () => {
  const cases: [string, string][] = [
    ["CREATE TABLE wishes (id INTEGER)", "create against the board"],
    ["CREATE TABLE IF NOT EXISTS wishes (id INTEGER)", "create-if-not-exists against the board"],
    ["ALTER TABLE wishes ADD COLUMN hacked TEXT", "alter the board"],
    ["DROP TABLE IF EXISTS wishes", "drop the board"],
    ["CREATE INDEX sneaky ON wishes (id)", "index the board"],
    ["DROP TABLE runs", "drop the run log"],
  ];
  for (const [sql, label] of cases) {
    it(`refuses to ${label}`, async () => {
      await expect(pd.withProductData("site", [sql], async () => 0)).rejects.toThrow(/platform table/);
    });
  }

  it("refuses BEFORE executing anything — a good statement beside a bad one does not run", async () => {
    await expect(
      pd.withProductData("site", [
        `CREATE TABLE IF NOT EXISTS demo_leak (id INTEGER PRIMARY KEY)`,
        `DROP TABLE wishes`,
      ], async () => 0),
    ).rejects.toThrow(/platform table/);
    const exists = await pd.withProductData("site", [], async (db) =>
      (await db.execute("SELECT name FROM sqlite_master WHERE name = 'demo_leak'")).rows.length,
    );
    expect(exists).toBe(0);
  });
});
