/**
 * The storage meter — the one thing still gated at filing time.
 *
 * Token totals are rolled up by `recordSpend` (tested in workers.test); build
 * rationing moved to tiers. What lives here is bytes: they sit on disk whether
 * or not a wish is ever built, so they are refused at the door, and the refusal
 * is the part that costs a user something when it is wrong.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const IDENTITY = join(tmpdir(), `x-test-usage-${process.pid}.db`);
process.env.ACCOUNTS_DATABASE_URL = `file:${IDENTITY}`;

let usage: typeof import("../app/lib/usage");
let accounts: typeof import("../app/lib/identity/accounts");

let n = 0;
const ACCT = () => accounts.getOrCreateConsumerByEmail(`u${++n}@example.com`);

beforeAll(async () => {
  usage = await import("../app/lib/usage");
  accounts = await import("../app/lib/identity/accounts");
  return () => rmSync(IDENTITY, { force: true });
});

describe("recording", () => {
  it("starts an unknown account at zero rather than throwing", async () => {
    const u = await usage.usageFor(999_999);
    expect(u.tokens).toBe(0);
    expect(u.bytes).toBe(0);
  });

  it("accumulates bytes instead of overwriting", async () => {
    const a = await ACCT();
    await usage.recordBytes(a.id, 1_000);
    await usage.recordBytes(a.id, 2_500);
    expect((await usage.usageFor(a.id)).bytes).toBe(3_500);
  });

  it("ignores a nonsense byte count rather than corrupting the total", async () => {
    const a = await ACCT();
    await usage.recordBytes(a.id, Number.NaN);
    await usage.recordBytes(a.id, -50);
    expect((await usage.usageFor(a.id)).bytes).toBe(0);
  });

  it("counts filed wishes as the legibility denominator", async () => {
    const a = await ACCT();
    await usage.recordWishFiled(a.id);
    await usage.recordWishFiled(a.id);
    expect((await usage.usageFor(a.id)).wishesFiled).toBe(2);
  });

  it("keeps one account's usage out of another's", async () => {
    const [a, b] = [await ACCT(), await ACCT()];
    await usage.recordBytes(a.id, 9_000);
    expect((await usage.usageFor(b.id)).bytes).toBe(0);
  });
});

describe("the refusal", () => {
  it("lets a fresh account file", async () => {
    const a = await ACCT();
    expect((await usage.allowanceFor(a.id)).ok).toBe(true);
  });

  it("REFUSES once storage is full, and says how to fix it", async () => {
    const a = await ACCT();
    await usage.recordBytes(a.id, usage.FREE_BYTES);
    const v = await usage.allowanceFor(a.id);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/delete some attachments/i);
  });

  it("never refuses an admin", async () => {
    const a = await ACCT();
    await usage.recordBytes(a.id, usage.FREE_BYTES * 2);
    expect((await usage.allowanceFor(a.id, true)).ok).toBe(true);
  });
});
