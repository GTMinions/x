/**
 * The game product's data layer, without a database: the seed round-trips
 * through the table declarations, and the generated files are current.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DDL, REFERENCE, SCHEMA_SQL, fromRow, toRow, type Row } from "@/app/(products)/inference-economics/data/schema";
import seed from "@/app/(products)/inference-economics/data/seed.json";

const DIR = path.join(process.cwd(), "app/(products)/inference-economics");
const s = seed as unknown as Record<string, unknown>;

describe("the world round-trips through the schema", () => {
  for (const t of REFERENCE) {
    it(`${t.name} ← ${t.seed}`, () => {
      const objs = s[t.seed] as Row[];
      expect(objs.length).toBeGreaterThan(0);
      for (const obj of objs) {
        const back = fromRow(t, toRow(t, obj));
        // What the game reads must equal what the seed says; absent fields stay absent.
        for (const [field] of t.cols) {
          if (obj[field] === undefined || obj[field] === null) expect(back[field]).toBeUndefined();
          else expect(back[field]).toEqual(obj[field]);
        }
      }
    });
  }
  it("names every table the DDL creates exactly once", () => {
    const created = DDL.map((d) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(d)?.[1]).filter(Boolean);
    expect(new Set(created).size).toBe(created.length);
    for (const t of REFERENCE) expect(created).toContain(t.name);
    for (const n of ["ie_milestones", "ie_terms", "ie_config", "ie_saves", "ie_runs"]) expect(created).toContain(n);
  });
  it("keeps the shapes the game depends on", () => {
    expect((s.years as Row[]).map((y) => y.y)).toEqual([2022, 2023, 2024, 2025, 2026, 2027, 2028]);
    expect((s.pretrain_years as Row[]).map((y) => y.y)).toEqual([2023, 2024, 2025, 2026, 2027, 2028]);
    expect((s.power as Row[]).find((p) => p.k === "grid")?.ferc).toBe(true);
    const cfg = s.config as Record<string, unknown>;
    expect(cfg.BATCH).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512]);
    expect(Object.keys(s.terms as object)).toEqual(["bu1", "bu2"]);
  });
});

describe("the generated files are current (run `pnpm game:embed` after editing _game/*)", () => {
  it("_game/bundle.ts embeds the current index.html and game.js", async () => {
    const html = fs.readFileSync(path.join(DIR, "_game/index.html"), "utf8");
    const js = fs.readFileSync(path.join(DIR, "_game/game.js"), "utf8");
    const b = await import("@/app/(products)/inference-economics/_game/bundle");
    expect(b.GAME_HTML).toBe(html);
    expect(b.GAME_JS).toBe(js);
    expect(b.GAME_JS_HASH).toBe(createHash("sha256").update(js).digest("hex").slice(0, 16));
  });
  it("data/schema.sql matches the declaration", () => {
    expect(fs.readFileSync(path.join(DIR, "data/schema.sql"), "utf8")).toBe(SCHEMA_SQL);
  });
  it("the game reads its world and saves from the product, not from literals", () => {
    const js = fs.readFileSync(path.join(DIR, "_game/game.js"), "utf8");
    expect(js).not.toMatch(/localStorage\./);
    expect(js).toContain("window.__IE_DATA.hardware");
    expect(js).toContain("D.pretrain_years");
    expect(js).toContain("__IE_STORE.run('bu1'");
    expect(js).toContain("__IE_STORE.run('bu2'");
  });
});
