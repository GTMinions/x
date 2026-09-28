/**
 * The abuse ceilings.
 *
 * Every one of these exists because the failure it prevents is a bill or a
 * full database rather than an error — the kind nobody notices until the
 * invoice. They are cheap to get subtly wrong (an off-by-one that charges a
 * refused request, a cap that counts calls when the cost is bytes), so they
 * are tested rather than eyeballed.
 */
import { describe, expect, it } from "vitest";
import { hit, spend } from "../app/lib/rateLimit";
import { maxDatabases } from "../app/lib/turso";

const key = () => `test-${Math.random().toString(36).slice(2)}`;
const HOUR = 3_600_000;

describe("counting requests", () => {
  it("allows up to the limit and then refuses", () => {
    const k = key();
    for (let i = 0; i < 5; i++) expect(hit(k, 5, HOUR).ok).toBe(true);
    expect(hit(k, 5, HOUR).ok).toBe(false);
  });

  it("tells the caller when to come back", () => {
    const k = key();
    hit(k, 1, HOUR);
    const refused = hit(k, 1, HOUR);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfter).toBeGreaterThan(0);
  });
});

describe("spending a byte budget", () => {
  // Counting requests bounds nothing useful for attachments: twenty uploads at
  // the per-file cap is still tens of megabytes an hour, base64-inflated, into
  // a database that is billed. The budget is what actually bounds it.
  it("accumulates cost rather than calls", () => {
    const k = key();
    expect(spend(k, 5_000_000, 20_000_000, HOUR).ok).toBe(true);
    expect(spend(k, 5_000_000, 20_000_000, HOUR).ok).toBe(true);
    expect(spend(k, 9_000_000, 20_000_000, HOUR).ok).toBe(true);
    expect(spend(k, 2_000_000, 20_000_000, HOUR).ok).toBe(false);
  });

  it("reports how much is left so the message can be useful", () => {
    const k = key();
    spend(k, 19_000_000, 20_000_000, HOUR);
    expect(spend(k, 2_000_000, 20_000_000, HOUR).remaining).toBe(1_000_000);
  });

  it("charges nothing for a refusal", () => {
    // Otherwise one oversized attempt burns an allowance it was never allowed
    // to use, and a user is locked out by a request that did nothing.
    const k = key();
    spend(k, 19_000_000, 20_000_000, HOUR);
    expect(spend(k, 5_000_000, 20_000_000, HOUR).ok).toBe(false);
    expect(spend(k, 1_000_000, 20_000_000, HOUR).ok).toBe(true);
  });

  it("refuses a single item larger than the whole budget, without consuming it", () => {
    const k = key();
    expect(spend(k, 999_000_000, 20_000_000, HOUR).ok).toBe(false);
    expect(spend(k, 20_000_000, 20_000_000, HOUR).ok).toBe(true);
  });

  it("keeps separate keys separate", () => {
    const a = key();
    const b = key();
    expect(spend(a, 20_000_000, 20_000_000, HOUR).ok).toBe(true);
    expect(spend(b, 20_000_000, 20_000_000, HOUR).ok).toBe(true);
  });
});

describe("the database ceiling", () => {
  it("has a bounded default rather than none", () => {
    // The guard exists so a bug, or an attacker who can influence a scope name,
    // cannot run up a Turso account one CREATE at a time.
    expect(maxDatabases()).toBeGreaterThan(0);
    expect(maxDatabases()).toBeLessThanOrEqual(50);
  });

  it("honours an override, and ignores nonsense", () => {
    const original = process.env.TURSO_MAX_DATABASES;
    try {
      process.env.TURSO_MAX_DATABASES = "3";
      expect(maxDatabases()).toBe(3);
      process.env.TURSO_MAX_DATABASES = "not a number";
      expect(maxDatabases()).toBeGreaterThan(0); // falls back, never to zero or NaN
      process.env.TURSO_MAX_DATABASES = "-5";
      expect(maxDatabases()).toBeGreaterThan(0);
    } finally {
      if (original === undefined) delete process.env.TURSO_MAX_DATABASES;
      else process.env.TURSO_MAX_DATABASES = original;
    }
  });
});
