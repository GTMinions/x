/**
 * Worker registry and token ledger.
 *
 * A retry must not bill twice, and liveness must not survive a crash.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `x-test-workers-${process.pid}.db`);
process.env.ACCOUNTS_DATABASE_URL = `file:${DB}`;
process.env.WORKER_ALIVE_SECONDS = "2";
// Timestamps are whole seconds, so a 2.2s sleep can read as exactly 2 seconds
// of age and sit on the boundary. The sleeps below clear it rather than testing
// the rounding.

let w: typeof import("../app/lib/workers");
let accounts: typeof import("../app/lib/identity/accounts");
let usage: typeof import("../app/lib/usage");

let n = 0;
const acct = () => accounts.getOrCreateConsumerByEmail(`w${++n}@example.com`);

beforeAll(async () => {
  w = await import("../app/lib/workers");
  accounts = await import("../app/lib/identity/accounts");
  usage = await import("../app/lib/usage");
  return () => rmSync(DB, { force: true });
});

describe("the registry", () => {
  it("records a worker and reads it back alive", async () => {
    await w.registerWorker("worker-1", "first");
    const found = (await w.listWorkers()).find((x) => x.id === "worker-1");
    expect(found?.alive).toBe(true);
    expect(found?.label).toBe("first");
  });

  it("re-registering keeps the id and the first-seen time", async () => {
    // A worker that restarts must keep its id, or after a crash it queues
    // behind itself instead of re-taking the lease it already held.
    await w.registerWorker("worker-2", "before");
    const first = (await w.listWorkers()).find((x) => x.id === "worker-2")!;
    await new Promise((r) => setTimeout(r, 1100));
    await w.registerWorker("worker-2", "after");
    const again = (await w.listWorkers()).find((x) => x.id === "worker-2")!;

    expect(again.registeredAt).toBe(first.registeredAt);
    expect(again.lastSeenAt).toBeGreaterThan(first.lastSeenAt);
    expect(again.label).toBe("after");
  });

  it("GOES QUIET ON ITS OWN when the worker stops reporting", async () => {
    // Derived from the clock, never written by the worker — a crashed worker
    // does not get to leave `online` behind it.
    await w.registerWorker("worker-doomed");
    expect((await w.listWorkers()).find((x) => x.id === "worker-doomed")?.alive).toBe(true);
    await new Promise((r) => setTimeout(r, 3400));
    expect((await w.listWorkers()).find((x) => x.id === "worker-doomed")?.alive).toBe(false);
  });
});

describe("the ledger", () => {
  it("records a spend and rolls it into the account total", async () => {
    const a = await acct();
    const res = await w.recordSpend({
      accountId: a.id, wishId: 101, scope: "site", workerId: "worker-1",
      model: "a-model", inputTokens: 1_000, cacheReadTokens: 60_000,
      cacheWriteTokens: 2_000, outputTokens: 500,
      idempotencyKey: "101:run-a",
    });
    expect(res.recorded).toBe(true);

    const u = await usage.usageFor(a.id);
    expect(u.tokensIn).toBe(63_000);   // input + cache read + cache write
    expect(u.tokensOut).toBe(500);
  });

  it("REFUSES THE SAME SPEND TWICE — a retry is not a second charge", async () => {
    const a = await acct();
    const spend = {
      accountId: a.id, wishId: 202, model: "a-model",
      inputTokens: 5_000, outputTokens: 1_000, idempotencyKey: "202:run-b",
    };
    expect((await w.recordSpend(spend)).recorded).toBe(true);
    expect((await w.recordSpend(spend)).recorded).toBe(false);

    // The total moved exactly once.
    const u = await usage.usageFor(a.id);
    expect(u.tokensIn).toBe(5_000);
    expect(u.tokensOut).toBe(1_000);
  });

  it("does record a genuinely different run on the same wish", async () => {
    // The key distinguishes "retried" from "ran again". A second attempt at the
    // same wish is real work and must be paid for.
    const a = await acct();
    await w.recordSpend({ accountId: a.id, wishId: 303, outputTokens: 100, idempotencyKey: "303:run-1" });
    await w.recordSpend({ accountId: a.id, wishId: 303, outputTokens: 100, idempotencyKey: "303:run-2" });
    expect(await w.ledgerForWish(303)).toHaveLength(2);
  });

  it("keeps cache reads apart from fresh input", async () => {
    // The distinction the pricing question turns on: one measured run counted
    // 66M tokens of which 1,216 were fresh. Lumping them together overstates
    // that run's cost by roughly a hundred times.
    const a = await acct();
    await w.recordSpend({
      accountId: a.id, wishId: 404, inputTokens: 1_216,
      cacheReadTokens: 66_171_878, outputTokens: 4_000,
      idempotencyKey: "404:run-c",
    });
    const [row] = await w.ledgerForWish(404);
    expect(row!.inputTokens).toBe(1_216);
    expect(row!.cacheReadTokens).toBe(66_171_878);
  });

  it("keeps one account's spend out of another's", async () => {
    const [a, b] = [await acct(), await acct()];
    await w.recordSpend({ accountId: a.id, wishId: 505, outputTokens: 9_000, idempotencyKey: "505:run-d" });
    expect((await usage.usageFor(b.id)).tokensOut).toBe(0);
    expect(await w.ledgerFor(b.id)).toHaveLength(0);
  });
});

describe("what a wish actually costs", () => {
  it("says how many samples it is based on", async () => {
    // Two runs are an anecdote. A price set from an anecdote is a guess wearing
    // a decimal point, so the sample count travels with the figure.
    const stats = await w.wishCostStats();
    expect(stats).not.toBeNull();
    expect(stats!.samples).toBeGreaterThan(0);
    expect(stats!.medianTokens).toBeGreaterThan(0);
  });

  it("sums every row belonging to one wish", async () => {
    const a = await acct();
    await w.recordSpend({ accountId: a.id, wishId: 606, outputTokens: 1_000, idempotencyKey: "606:r1" });
    await w.recordSpend({ accountId: a.id, wishId: 606, outputTokens: 3_000, idempotencyKey: "606:r2" });
    const rows = await w.ledgerForWish(606);
    expect(rows.reduce((t, r) => t + r.outputTokens, 0)).toBe(4_000);
  });
});
