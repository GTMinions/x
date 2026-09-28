/**
 * The guest list.
 *
 * It grants free access AND top queue position, so the tests are about the ways
 * that must not leak:
 *
 *   It fails CLOSED. An unreachable table hands out nothing — the worst case is
 *   a guest waiting like everybody else, never a stranger jumping the queue.
 *
 *   It sits BELOW the operator and ABOVE paying customers, and it applies
 *   inside a product too — unlike an operator's own wishes, which are scoped to
 *   the platform. The difference is that a guest was put there on purpose.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `x-test-comps-${process.pid}.db`);
process.env.ACCOUNTS_DATABASE_URL = `file:${DB}`;

let comps: typeof import("../app/lib/comps");
let tiers: typeof import("../app/lib/tiers");
let accounts: typeof import("../app/lib/identity/accounts");

const DAY = new Date("2026-09-05T10:00:00Z");
let n = 0;
const acct = () => accounts.getOrCreateConsumerByEmail(`c${++n}@example.com`);

beforeAll(async () => {
  comps = await import("../app/lib/comps");
  tiers = await import("../app/lib/tiers");
  accounts = await import("../app/lib/identity/accounts");
  await tiers.upsertTier(
    { id: "pro", name: "Pro", priceCents: 999, guarantee: { perDay: 10, perMonth: null }, rank: 3, requiresCard: true, blurb: "" },
    "test",
  );
  return () => rmSync(DB, { force: true });
});

describe("the list", () => {
  it("holds an address before that person has an account", async () => {
    // The invitation is the point: a table that can only name existing accounts
    // records acceptances, not invitations.
    await comps.addComp("future@example.com", "design partner", "admin@example.com");
    expect(await comps.isComped("future@example.com")).toBe(true);
  });

  it("is case- and whitespace-insensitive on the way in and out", async () => {
    await comps.addComp("  MiXeD@Example.COM ", null, "admin@example.com");
    expect(await comps.isComped("mixed@example.com")).toBe(true);
    expect(await comps.isComped(" MIXED@EXAMPLE.COM ")).toBe(true);
  });

  it("re-adding updates the note rather than failing", async () => {
    // The second attempt is usually somebody correcting why the person is here.
    await comps.addComp("dup@example.com", "first reason", "a@example.com");
    await comps.addComp("dup@example.com", "better reason", "b@example.com");
    const row = (await comps.listComps()).find((c) => c.email === "dup@example.com");
    expect(row?.note).toBe("better reason");
  });

  it("removes cleanly", async () => {
    await comps.addComp("temp@example.com", null, "admin@example.com");
    await comps.removeComp("TEMP@example.com");
    expect(await comps.isComped("temp@example.com")).toBe(false);
  });

  it("says no to an empty or absent address rather than throwing", async () => {
    expect(await comps.isComped(null)).toBe(false);
    expect(await comps.isComped("")).toBe(false);
    expect(await comps.isComped("nobody@example.com")).toBe(false);
  });

  it("refuses something that is not an address", async () => {
    await expect(comps.addComp("not-an-email", null, "admin@example.com")).rejects.toThrow();
  });

  it("answers for a batch in one query", async () => {
    await comps.addComp("batch1@example.com", null, "a@example.com");
    const found = await comps.compedAmong(["batch1@example.com", "BATCH1@example.com", "nope@example.com"]);
    expect(found.has("batch1@example.com")).toBe(true);
    expect(found.has("nope@example.com")).toBe(false);
  });
});

describe("where a guest lands in the queue", () => {
  const tierOf = async () => "pro" as const;
  const NOBODY = async () => false;

  it("SORTS ABOVE A PAYING CUSTOMER, inside a product", async () => {
    // The whole point of the feature, and the thing the pricing page's ordering
    // is quietly subordinate to.
    const [guest, payer] = [await acct(), await acct()];
    const ranked = [{ id: 1, scope: "ai-edu" }, { id: 2, scope: "ai-edu" }];
    const owners = new Map<number, number>([[1, payer.id], [2, guest.id]]);
    const isComped = async (id: number) => id === guest.id;

    const out = await tiers.prioritise(ranked, owners, tierOf, NOBODY, DAY, isComped);
    expect(out.map((p) => p.wish.id)).toEqual([2, 1]);
    expect(out[0]!.band).toBe(tiers.BAND.comped);
  });

  it("still sits BELOW the operator's own platform work", async () => {
    const [guest, me] = [await acct(), await acct()];
    const ranked = [{ id: 11, scope: "ai-edu" }, { id: 12, scope: "site" }];
    const owners = new Map<number, number>([[11, guest.id], [12, me.id]]);
    const isOperator = async (id: number) => id === me.id;
    const isComped = async (id: number) => id === guest.id;

    const out = await tiers.prioritise(ranked, owners, tierOf, isOperator, DAY, isComped);
    expect(out.map((p) => p.wish.id)).toEqual([12, 11]);
  });

  it("is not metered — a guest has no guarantee to run out of", async () => {
    const guest = await acct();
    const ranked = Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, scope: "ai-edu" }));
    const owners = new Map(ranked.map((w) => [w.id, guest.id]));
    const isComped = async () => true;

    const out = await tiers.prioritise(ranked, owners, tierOf, NOBODY, DAY, isComped);
    // All forty, all guaranteed — well past the tier's ten a day.
    expect(out.filter((p) => p.band === tiers.BAND.comped)).toHaveLength(40);
  });

  it("changes nothing for anybody not on the list", async () => {
    const payer = await acct();
    const out = await tiers.prioritise(
      [{ id: 200, scope: "ai-edu" }],
      new Map([[200, payer.id]]),
      tierOf,
      NOBODY,
      DAY,
      async () => false,
    );
    expect(out[0]!.band).toBe(tiers.BAND.guaranteed);
  });
});
