/**
 * Tier guarantees and queue order.
 *
 * The key property: a guarantee is a floor, not a ceiling — a wish past it must
 * come back LAST, never absent. A refactor into a filter would pass a test that
 * only counted the guaranteed ones.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `x-test-tiers-${process.pid}.db`);
process.env.ACCOUNTS_DATABASE_URL = `file:${DB}`;
// Tiers come from the database now, not the environment — the whole point is
// that this repository carries no prices. The suite inserts its own.

let t: typeof import("../app/lib/tiers");
let accounts: typeof import("../app/lib/identity/accounts");

let n = 0;
const acct = () => accounts.getOrCreateConsumerByEmail(`t${++n}@example.com`);

const DAY = new Date("2026-08-29T10:00:00Z");
const NEXT_DAY = new Date("2026-08-30T10:00:00Z");
const NEXT_MONTH = new Date("2026-09-02T10:00:00Z");

let wish = 0;
const ship = (id: number, at: Date, w = ++wish) => t.recordFulfilment(id, w, at);

const NOBODY = async () => false;
const tierIs = (id: "free" | "plus" | "pro") => async () => id;

beforeAll(async () => {
  t = await import("../app/lib/tiers");
  accounts = await import("../app/lib/identity/accounts");
  // Not the operator's real numbers — these test behaviour, not pricing.
  // of a guarantee, and pinning it to whatever a deployment happens to sell
  // would make the tests fail whenever somebody changed a price.
  await t.upsertTier({ id: "free", name: "Free", priceCents: 0,
    guarantee: { perDay: null, perMonth: 1 }, rank: 1, requiresCard: true, blurb: "" }, "test");
  await t.upsertTier({ id: "plus", name: "Plus", priceCents: 100,
    guarantee: { perDay: 3, perMonth: null }, rank: 2, requiresCard: true, blurb: "" }, "test");
  await t.upsertTier({ id: "pro", name: "Pro", priceCents: 200,
    guarantee: { perDay: 10, perMonth: 5 }, rank: 3, requiresCard: true, blurb: "" }, "test");
  return () => rmSync(DB, { force: true });
});

describe("counting what was built", () => {
  it("REFUSES TO COUNT THE SAME WISH TWICE — a retry is not a second build", async () => {
    const a = await acct();
    await t.recordFulfilment(a.id, 5001, DAY);
    await t.recordFulfilment(a.id, 5001, DAY);
    expect(await t.builtToday(a.id, DAY)).toBe(1);
  });

  it("keeps a wish on the day it shipped, even when the retry lands tomorrow", async () => {
    // Stamped at the first write. Otherwise a retry after midnight moves a wish
    // into a day it did not belong to, silently freeing a slot.
    const a = await acct();
    await t.recordFulfilment(a.id, 5002, DAY);
    await t.recordFulfilment(a.id, 5002, NEXT_DAY);
    expect(await t.builtToday(a.id, DAY)).toBe(1);
    expect(await t.builtToday(a.id, NEXT_DAY)).toBe(0);
  });

  it("rolls over at the day boundary, and keeps the month", async () => {
    const a = await acct();
    await ship(a.id, DAY);
    await ship(a.id, NEXT_DAY);
    expect(await t.builtToday(a.id, NEXT_DAY)).toBe(1);
    expect(await t.builtThisMonth(a.id, NEXT_DAY)).toBe(2);
    expect(await t.builtThisMonth(a.id, NEXT_MONTH)).toBe(0);
  });

  it("keeps one account's count out of another's", async () => {
    const [a, b] = [await acct(), await acct()];
    await ship(a.id, DAY);
    expect(await t.builtToday(b.id, DAY)).toBe(0);
  });
});

describe("what is still owed", () => {
  it("free is owed one a MONTH, and a new day does not refill it", async () => {
    // The reason free counts by the month: one a day would be thirty a month,
    // a third of Plus, and a free tier that competes with the cheapest paid one
    // leaves no paid tier under it.
    const a = await acct();
    expect((await t.standingFor(a.id, "free", DAY)).guaranteedLeft).toBe(1);
    await ship(a.id, DAY);
    expect((await t.standingFor(a.id, "free", DAY)).guaranteedLeft).toBe(0);
    expect((await t.standingFor(a.id, "free", NEXT_DAY)).guaranteedLeft).toBe(0);
    expect((await t.standingFor(a.id, "free", NEXT_MONTH)).guaranteedLeft).toBe(1);
  });

  it("plus is owed three a day, and tomorrow refills it", async () => {
    const a = await acct();
    for (let i = 0; i < 3; i++) await ship(a.id, DAY);
    expect((await t.standingFor(a.id, "plus", DAY)).guaranteedLeft).toBe(0);
    expect((await t.standingFor(a.id, "plus", NEXT_DAY)).guaranteedLeft).toBe(3);
  });

  it("pro is owed ten a day", async () => {
    const a = await acct();
    for (let i = 0; i < 4; i++) await ship(a.id, DAY);
    expect((await t.standingFor(a.id, "pro", DAY)).guaranteedLeft).toBe(6);
  });

  it("leaves the monthly circuit breaker OFF unless an operator set one", async () => {
    // A bound nobody asked for turns a guarantee back into the cap it was
    // deliberately not. No TIER_PLUS_PER_MONTH is set, so Plus has none.
    const a = await acct();
    for (let i = 0; i < 40; i++) await ship(a.id, DAY);
    expect((await t.standingFor(a.id, "plus", DAY)).overMonthlyCap).toBe(false);
    expect((await t.tierById("plus")).guarantee.perMonth).toBeNull();
  });

  it("honours the breaker once an operator sets one", async () => {
    const a = await acct();
    for (let i = 0; i < 5; i++) await ship(a.id, DAY);
    expect((await t.standingFor(a.id, "pro", DAY)).overMonthlyCap).toBe(true);
    // A new month clears it; a new day does not.
    expect((await t.standingFor(a.id, "pro", NEXT_DAY)).overMonthlyCap).toBe(true);
    expect((await t.standingFor(a.id, "pro", NEXT_MONTH)).overMonthlyCap).toBe(false);
  });

  it("rations nothing when there is no account behind the wish", async () => {
    expect((await t.standingFor(null, "free", DAY)).guaranteedLeft).toBeNull();
  });
});

describe("ordering the queue", () => {
  it("NEVER DROPS A WISH — past the guarantee means last, not gone", async () => {
    // The property the whole design rests on. A filter would pass a test that
    // only counted the guaranteed ones.
    const a = await acct();
    const ranked = [{ id: 1, scope: "ai-edu" }, { id: 2, scope: "ai-edu" }, { id: 3, scope: "ai-edu" }, { id: 4, scope: "ai-edu" }, { id: 5, scope: "ai-edu" }];
    const owners = new Map(ranked.map((w) => [w.id, a.id]));

    const out = await t.prioritise(ranked, owners, tierIs("plus"), NOBODY, DAY);
    expect(out).toHaveLength(5);
    expect(out.filter((p) => p.guaranteed)).toHaveLength(3); // plus guarantees 3
    expect(out.map((p) => p.wish.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("STOPS A WHOLE BACKLOG counting as guaranteed, not just the first past the line", async () => {
    const a = await acct();
    const ranked = [{ id: 1, scope: "ai-edu" }, { id: 2, scope: "ai-edu" }, { id: 3, scope: "ai-edu" }, { id: 4, scope: "ai-edu" }];
    const owners = new Map(ranked.map((w) => [w.id, a.id]));

    const out = await t.prioritise(ranked, owners, tierIs("free"), NOBODY, DAY);
    expect(out.filter((p) => p.guaranteed)).toHaveLength(1); // free guarantees 1
  });

  it("puts a higher tier's guaranteed work first", async () => {
    const [free, pro] = [await acct(), await acct()];
    const ranked = [{ id: 11, scope: "ai-edu" }, { id: 12, scope: "ai-edu" }];
    const owners = new Map<number, number>([[11, free.id], [12, pro.id]]);
    const tierOf = async (id: number) => (id === pro.id ? ("pro" as const) : ("free" as const));

    // 11 is ahead on the board, but 12 belongs to the higher tier.
    const out = await t.prioritise(ranked, owners, tierOf, NOBODY, DAY);
    expect(out.map((p) => p.wish.id)).toEqual([12, 11]);
  });

  it("PUTS THE OPERATOR FIRST on the SITE scope, whatever anyone paid", async () => {
    const [me, pro] = [await acct(), await acct()];
    const ranked = [{ id: 21, scope: "ai-edu" }, { id: 22, scope: "site" }];
    const owners = new Map<number, number>([[21, pro.id], [22, me.id]]);
    const tierOf = async (id: number) => (id === pro.id ? ("pro" as const) : ("free" as const));
    const isOperator = async (id: number) => id === me.id;

    const out = await t.prioritise(ranked, owners, tierOf, isOperator, DAY);
    expect(out[0]!.wish.id).toBe(22);
    expect(out[0]!.band).toBe(t.BAND.operator);
  });

  it("DOES NOT let an operator jump the queue INSIDE A PRODUCT", async () => {
    // Running the platform is not a rank inside somebody's product. Filing
    // against a product makes you one of that product's users, and a paying
    // customer there is ahead of a free-tier operator — otherwise the pricing
    // page describes an order the queue does not actually use.
    const [me, pro] = [await acct(), await acct()];
    const ranked = [{ id: 31, scope: "ai-edu" }, { id: 32, scope: "ai-edu" }];
    const owners = new Map<number, number>([[31, me.id], [32, pro.id]]);
    const tierOf = async (id: number) => (id === pro.id ? ("pro" as const) : ("free" as const));
    const isOperator = async (id: number) => id === me.id;

    const out = await t.prioritise(ranked, owners, tierOf, isOperator, DAY);
    expect(out.map((p) => p.wish.id)).toEqual([32, 31]);
    expect(out[1]!.band).not.toBe(t.BAND.operator);
  });

  it("KEEPS THE BOARD'S ORDER inside a band", async () => {
    const [a, b] = [await acct(), await acct()];
    const ranked = [{ id: 31, scope: "ai-edu" }, { id: 32, scope: "ai-edu" }, { id: 33, scope: "ai-edu" }];
    const owners = new Map<number, number>([[31, a.id], [32, b.id], [33, a.id]]);

    const out = await t.prioritise(ranked, owners, tierIs("plus"), NOBODY, DAY);
    expect(out.map((p) => p.wish.id)).toEqual([31, 32, 33]);
  });

  it("SINKS A WISH NOBODY OWNS below customers, without dropping it", async () => {
    // No owner means a legacy import or a CLI-minted wish. It used to land in
    // the operator band — which made "no account" the fastest queue position on
    // the board, above people who pay.
    const [payer] = [await acct()];
    const ranked = [{ id: 41, scope: "ai-edu" }, { id: 42, scope: "ai-edu" }];
    const owners = new Map<number, number>([[42, payer.id]]);
    const out = await t.prioritise(ranked, owners, tierIs("free"), NOBODY, DAY);
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.wish.id)).toEqual([42, 41]);
    expect(out[1]!.band).toBe(t.BAND.spare);
  });

  it("SINKS A CAPPED ACCOUNT BELOW EVERYBODY, still without dropping it", async () => {
    // Even the breaker does not refuse. It re-orders — which is the difference
    // between "you have had your share for now" and "no".
    const [capped, free] = [await acct(), await acct()];
    for (let i = 0; i < 5; i++) await ship(capped.id, DAY);

    const ranked = [{ id: 51, scope: "ai-edu" }, { id: 52, scope: "ai-edu" }];
    const owners = new Map<number, number>([[51, capped.id], [52, free.id]]);
    const tierOf = async (id: number) => (id === capped.id ? ("pro" as const) : ("free" as const));

    const out = await t.prioritise(ranked, owners, tierOf, NOBODY, DAY);
    expect(out).toHaveLength(2);
    // Pro outranks free, and 51 was first on the board — the breaker is the
    // only reason it now sorts last.
    expect(out.map((p) => p.wish.id)).toEqual([52, 51]);
    expect(out[1]!.band).toBe(t.BAND.capped);
    expect(out[1]!.guaranteed).toBe(false);
  });
});
