/**
 * Claiming a wish, with more than one worker.
 *
 * The old claim read the wish, saw `ready`, and wrote `building`. Two workers
 * reading at the same time both saw `ready` and both wrote — nothing in the
 * second write said "only if still unclaimed" — so both believed they owned it
 * and built the same wish on two branches. One of them loses its work at merge,
 * and neither ever learns why.
 *
 * These tests are written against the property that fixes it: the precondition
 * lives inside the UPDATE, so the database picks the winner in one statement.
 * The first test would pass on the broken implementation too if it claimed
 * sequentially — so it claims CONCURRENTLY, which is the only shape that can
 * tell the two apart.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `x-test-claims-${process.pid}.db`);
process.env.PRODUCT_DB_SITE_URL = `file:${DB}`;

let store: typeof import("../app/_platform/wishes/db");
type Wish = import("../app/_platform/wishes").Wish;

const draft = (o: Partial<Wish> = {}): Omit<Wish, "id" | "issueUrl"> => ({
  scope: "site", title: "claimable", body: "", status: "ready", role: "PM",
  nickname: "someone", source: "form", votes: 1, priority: null,
  needsApproval: false, followups: 0, media: [], comments: [],
  createdAt: "2026-08-29", closedAt: null, ...o,
});

const newWish = async (o: Partial<Wish> = {}) => (await store.createDbWish(draft(o)))!;

beforeAll(async () => {
  store = await import("../app/_platform/wishes/db");
  return () => rmSync(DB, { force: true });
});

describe("two workers, one wish", () => {
  it("EXACTLY ONE WINS when both claim at the same instant", async () => {
    const w = await newWish();
    // Concurrent on purpose. Sequential calls would pass even on a
    // read-then-write implementation, which is the bug this guards.
    const results = await Promise.all([
      store.claimWish("site", w.id, "worker-a"),
      store.claimWish("site", w.id, "worker-b"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("five workers racing still yields one winner", async () => {
    const w = await newWish();
    const results = await Promise.all(
      ["a", "b", "c", "d", "e"].map((n) => store.claimWish("site", w.id, `worker-${n}`)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("tells the loser why, in a word it can act on", async () => {
    const w = await newWish();
    await store.claimWish("site", w.id, "worker-a");
    const second = await store.claimWish("site", w.id, "worker-b");
    expect(second).toEqual({ ok: false, reason: "taken" });
  });

  it("lets the holder re-claim its own wish — a retry is not a conflict", async () => {
    // A worker that retries after a network blip must not lock itself out of
    // work it already owns.
    const w = await newWish();
    expect((await store.claimWish("site", w.id, "worker-a")).ok).toBe(true);
    expect((await store.claimWish("site", w.id, "worker-a")).ok).toBe(true);
  });
});

describe("the lease expires, so a dead worker frees its wish", () => {
  it("hands the wish to somebody else once the lease runs out", async () => {
    // The whole reason a claim is a lease. A flag would need a human to notice
    // the worker died; nobody will, and the wish sits in `building` for ever.
    const w = await newWish();
    expect((await store.claimWish("site", w.id, "worker-dead", 0)).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 1100));
    expect((await store.claimWish("site", w.id, "worker-live")).ok).toBe(true);
  });

  it("reports an expired lease as nobody holding it", async () => {
    const w = await newWish();
    await store.claimWish("site", w.id, "worker-dead", 0);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await store.claimHolder("site", w.id)).toBeNull();
  });

  it("a live lease names its holder", async () => {
    const w = await newWish();
    await store.claimWish("site", w.id, "worker-a");
    expect((await store.claimHolder("site", w.id))?.workerId).toBe("worker-a");
  });
});

describe("release", () => {
  it("releasing puts the wish back and frees the lease", async () => {
    const w = await newWish();
    await store.claimWish("site", w.id, "worker-a");
    expect(await store.releaseClaim("site", w.id, "worker-a")).toBe(true);

    const back = await store.getDbWish("site", w.id);
    expect(back!.status).toBe("ready");
    expect(await store.claimHolder("site", w.id)).toBeNull();
    expect((await store.claimWish("site", w.id, "worker-b")).ok).toBe(true);
  });

  it("a worker cannot release somebody else's claim", async () => {
    const w = await newWish();
    await store.claimWish("site", w.id, "worker-a");
    expect(await store.releaseClaim("site", w.id, "worker-b")).toBe(false);
    expect((await store.claimHolder("site", w.id))?.workerId).toBe("worker-a");
  });
});

describe("what may not be claimed at all", () => {
  it("refuses a wish awaiting approval", async () => {
    const w = await newWish({ status: "triage" });
    expect(await store.claimWish("site", w.id, "worker-a")).toEqual({ ok: false, reason: "not-claimable" });
  });

  it("refuses a wish that already shipped", async () => {
    const w = await newWish({ status: "done" });
    expect(await store.claimWish("site", w.id, "worker-a")).toEqual({ ok: false, reason: "not-claimable" });
  });
});
