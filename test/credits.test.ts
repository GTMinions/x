/**
 * Credit balances.
 *
 * Three properties: tuning the ratio must not revalue an existing balance, a
 * receipt must survive a ratio change, and a retried spend must cost nothing.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `x-test-credits-${process.pid}.db`);
process.env.ACCOUNTS_DATABASE_URL = `file:${DB}`;

let credits: typeof import("../app/lib/credits");
let workers: typeof import("../app/lib/workers");
let accounts: typeof import("../app/lib/identity/accounts");

let n = 0;
const acct = () => accounts.getOrCreateConsumerByEmail(`c${++n}@example.com`);

/** The settings cache holds for a few seconds, so a test that changes the ratio
 *  has to wait it out or it reads its own stale value. */
const RATIO_CACHE_MS = 5_500;
const setRatio = async (tokens: number) => {
  await credits.setCreditSetting("credit.tokens", tokens, "test");
  await new Promise((r) => setTimeout(r, RATIO_CACHE_MS));
};

beforeAll(async () => {
  credits = await import("../app/lib/credits");
  workers = await import("../app/lib/workers");
  accounts = await import("../app/lib/identity/accounts");
  return () => rmSync(DB, { force: true });
});

describe("the opening grant", () => {
  it("exists before the account has ever been written to", async () => {
    // A new account must SEE its credits, not acquire them on first spend.
    const a = await acct();
    const b = await credits.balanceFor(a.id);
    expect(b.purchased).toBeGreaterThan(0);
    expect(b.remaining).toBe(b.purchased);
  });

  it("lets a brand-new account file", async () => {
    const a = await acct();
    expect((await credits.canFile(a.id)).ok).toBe(true);
  });
});

describe("charging", () => {
  it("rounds up, and never charges zero for work that happened", async () => {
    // A wish that shipped for free teaches the user the next one is free too.
    const ratio = await credits.tokensPerCredit();
    expect(credits.creditsForTokens(1, ratio)).toBe(1);
    expect(credits.creditsForTokens(ratio, ratio)).toBe(1);
    expect(credits.creditsForTokens(ratio + 1, ratio)).toBe(2);
    expect(credits.creditsForTokens(0, ratio)).toBe(0);
  });

  it("a big wish costs proportionally more than a small one", async () => {
    // The skew is the point: the mean wish measured fourteen times the median,
    // and credits are the shape that lets that be an accounting fact rather
    // than a pricing problem.
    const ratio = await credits.tokensPerCredit();
    expect(credits.creditsForTokens(ratio * 10, ratio)).toBe(10);
  });

  it("blocks filing once the balance is gone, and says why", async () => {
    const a = await acct();
    const b = await credits.balanceFor(a.id);
    const ratio = await credits.tokensPerCredit();
    await credits.chargeTokens(a.id, ratio * b.purchased);

    const gate = await credits.canFile(a.id);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reason).toMatch(/top up/i);
  });

  it("records the overshoot rather than hiding it", async () => {
    // A charge lands at ship, when the cost is finally known, so it can arrive
    // after the balance was already thin. That is allowed once and then blocks.
    const a = await acct();
    const b = await credits.balanceFor(a.id);
    const ratio = await credits.tokensPerCredit();
    await credits.chargeTokens(a.id, ratio * (b.purchased + 3));

    const after = await credits.balanceFor(a.id);
    expect(after.remaining).toBe(0);
    expect(after.owed).toBe(3);
  });

  it("topping up clears the overshoot and lets filing resume", async () => {
    const a = await acct();
    const b = await credits.balanceFor(a.id);
    const ratio = await credits.tokensPerCredit();
    await credits.chargeTokens(a.id, ratio * (b.purchased + 2));
    expect((await credits.canFile(a.id)).ok).toBe(false);

    await credits.addCredits(a.id, 5);
    const after = await credits.balanceFor(a.id);
    expect(after.owed).toBe(0);
    expect(after.remaining).toBe(3);
    expect((await credits.canFile(a.id)).ok).toBe(true);
  });
});

describe("the ratio is an operator knob, not a revaluation", () => {
  it("DOES NOT MOVE A BALANCE ALREADY OWNED when it changes", async () => {
    // The load-bearing test. Held in tokens, somebody who bought 100 credits
    // would open the page after a tuning and see 50.
    const a = await acct();
    await credits.addCredits(a.id, 100);
    const before = await credits.balanceFor(a.id);

    await setRatio(1_000_000);
    const after = await credits.balanceFor(a.id);
    expect(after.purchased).toBe(before.purchased);
    expect(after.remaining).toBe(before.remaining);
  }, 20_000);

  it("changes only how far a credit goes from now on", async () => {
    const a = await acct();
    await credits.addCredits(a.id, 100);

    await setRatio(1_000_000);
    const cheap = await credits.chargeTokens(a.id, 10_000_000);
    expect(cheap.credits).toBe(10);
    expect(cheap.ratio).toBe(1_000_000);

    await setRatio(10_000_000);
    const dear = await credits.chargeTokens(a.id, 10_000_000);
    expect(dear.credits).toBe(1);
    expect(dear.ratio).toBe(10_000_000);
  }, 20_000);

  it("refuses a ratio that would divide by zero", async () => {
    // Dividing by this decides what everyone may spend.
    await expect(credits.setCreditSetting("credit.tokens", 0, "test")).rejects.toThrow();
    await expect(credits.setCreditSetting("credit.tokens", -5, "test")).rejects.toThrow();
  });
});

describe("the ledger, while pay-per-use is not live", () => {
  it("RECORDS THE SPEND BUT CHARGES NOTHING — tiers meter fulfilment today", async () => {
    // The live model is subscription tiers. Charging a balance nobody is
    // required to hold would strand every account at "owed" — so recordSpend
    // writes the ledger row and leaves the balance alone until pay-per-use
    // ships. This test is the contract for that suspension.
    const a = await acct();
    const before = await credits.balanceFor(a.id);

    await workers.recordSpend({
      accountId: a.id, wishId: 9001, model: "a-model",
      inputTokens: 1_000, cacheReadTokens: 4_000_000, outputTokens: 1_000,
      idempotencyKey: "9001:run-a",
    });

    const [row] = await workers.ledgerForWish(9001);
    expect(row!.creditsCharged).toBe(0);
    expect(row!.tokensPerCredit).toBeNull();
    expect((await credits.balanceFor(a.id)).spent).toBe(before.spent);
  });

  it("a duplicate report changes nothing at all", async () => {
    const a = await acct();
    const spend = {
      accountId: a.id, wishId: 9002, outputTokens: 5_000_000,
      idempotencyKey: "9002:run-b",
    };
    expect((await workers.recordSpend(spend)).recorded).toBe(true);
    const once = await credits.balanceFor(a.id);
    expect((await workers.recordSpend(spend)).recorded).toBe(false);
    expect((await credits.balanceFor(a.id)).spent).toBe(once.spent);
    expect(await workers.ledgerForWish(9002)).toHaveLength(1);
  });
});
