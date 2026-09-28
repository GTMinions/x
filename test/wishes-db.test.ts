/**
 * The wish store, against a real database.
 *
 * Wishes moved out of GitHub issues into one database per product. Everything
 * that used to be an issue field is now a column, and the risk of a move like
 * that is a field that quietly stops round-tripping — a wish that loses its
 * attachments, or comes back in the wrong stage, with nothing throwing.
 *
 * So the core assertion is a full round-trip of every field, not a smoke test
 * that a row exists. Two product databases are used throughout, because a
 * single one cannot show that scopes stay separate.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const A = join(tmpdir(), `x-test-wish-a-${process.pid}.db`);
const B = join(tmpdir(), `x-test-wish-b-${process.pid}.db`);
process.env.PRODUCT_DB_SITE_URL = `file:${A}`;
process.env.PRODUCT_DB_GTM_URL = `file:${B}`;

let store: typeof import("../app/_platform/wishes/db");
let stages: typeof import("../app/_platform/wishes/stages");
type Wish = import("../app/_platform/wishes").Wish;

const draft = (o: Partial<Wish> = {}): Omit<Wish, "id" | "issueUrl"> => ({
  scope: "site",
  title: "add a dark mode toggle",
  body: "the nav is unreadable at night",
  status: "ready",
  role: "UX",
  nickname: "bob",
  source: "form",
  votes: 3,
  priority: "p1",
  needsApproval: false,
  followups: 0,
  media: [{ name: "shot.png", type: "image/png", url: "https://example.com/shot.png" }],
  comments: [],
  createdAt: "2026-08-01",
  closedAt: null,
  ...o,
});

beforeAll(async () => {
  store = await import("../app/_platform/wishes/db");
  stages = await import("../app/_platform/wishes/stages");
  return () => {
    for (const f of [A, B]) rmSync(f, { force: true });
  };
});

describe("stages", () => {
  it("maps the old five-value vocabulary on read", () => {
    // Every wish filed before the move carries one of these, and so does every
    // issue the importer reads.
    expect(stages.readStage("new")).toBe("triage");
    expect(stages.readStage("pending")).toBe("backlog");
    expect(stages.readStage("in-progress")).toBe("building");
    expect(stages.readStage("wontfix")).toBe("declined");
    expect(stages.readStage("done")).toBe("done");
  });

  it("falls back rather than inventing a stage for junk", () => {
    expect(stages.readStage("nonsense", "ready")).toBe("ready");
    expect(stages.readStage(null)).toBe("triage");
  });

  it("groups every stage into exactly one category", () => {
    for (const s of stages.STAGE_IDS) {
      expect(["open", "active", "closed"]).toContain(stages.stageCategory(s));
    }
  });

  it("treats declined and duplicate as closed but not shipped", () => {
    // Collapsing these into `done` would file "we are not going to" next to the
    // work that shipped, and the board would report a delivery record it never had.
    expect(stages.isClosed("declined")).toBe(true);
    expect(stages.isClosed("duplicate")).toBe(true);
    expect(stages.isClosed("review")).toBe(false);
  });

  it("will not offer done on a wish nothing has built", () => {
    expect(stages.nextStages("ready")).not.toContain("done");
    expect(stages.nextStages("review")).toContain("done");
  });
});

describe("round-tripping a wish", () => {
  let made: Wish;

  it("stores one", async () => {
    const w = await store.createDbWish(draft());
    expect(w, store.wishStoreError() ?? "create returned null").not.toBeNull();
    made = w!;
  });

  it("returns every field unchanged", async () => {
    const back = await store.getDbWish("site", made.id);
    expect(back).not.toBeNull();
    expect(back).toMatchObject({
      title: "add a dark mode toggle",
      body: "the nav is unreadable at night",
      status: "ready",
      role: "UX",
      nickname: "bob",
      source: "form",
      votes: 3,
      priority: "p1",
      createdAt: "2026-08-01",
      closedAt: null,
    });
    // Media is JSON in a column — the field most likely to be lost silently.
    expect(back!.media).toEqual([
      { name: "shot.png", type: "image/png", url: "https://example.com/shot.png" },
    ]);
  });

  it("derives needsApproval from the stage rather than storing a second flag", async () => {
    const gated = await store.createDbWish(draft({ title: "gated", status: "triage" }));
    expect((await store.getDbWish("site", gated!.id))!.needsApproval).toBe(true);
    expect((await store.getDbWish("site", made.id))!.needsApproval).toBe(false);
  });

  it("applies an update and appends to the thread", async () => {
    const updated = await store.updateDbWish(
      "site",
      made.id,
      (w) => ({ ...w, status: "review", votes: w.votes + 1 }),
      { kind: "update", body: "built it", at: "2026-08-02T00:00:00Z", author: "loop" },
    );
    expect(updated!.status).toBe("review");
    expect(updated!.votes).toBe(4);

    const back = await store.getDbWish("site", made.id);
    expect(back!.comments).toHaveLength(1);
    expect(back!.comments[0]).toMatchObject({ kind: "update", body: "built it", author: "loop" });
  });
});

describe("scopes stay separate", () => {
  it("finds a wish across products without being told which one", async () => {
    const inSite = await store.createDbWish(draft({ scope: "site", title: "site wish" }));
    const inGtm = await store.createDbWish(draft({ scope: "gtm", title: "gtm wish" }));

    expect((await store.findDbWish(inSite!.id))!.title).toBe("site wish");
    expect((await store.findDbWish(inGtm!.id))!.title).toBe("gtm wish");
  });

  it("does not return one product's wish from another's database", async () => {
    const inGtm = await store.createDbWish(draft({ scope: "gtm", title: "gtm only" }));
    expect(await store.getDbWish("site", inGtm!.id)).toBeNull();
  });

  it("keeps ids unique across both databases under load", async () => {
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const w = await store.createDbWish(draft({ scope: i % 2 ? "gtm" : "site", title: `w${i}` }));
      expect(w).not.toBeNull();
      expect(seen.has(w!.id), `duplicate id ${w!.id}`).toBe(false);
      seen.add(w!.id);
    }
    expect(seen.size).toBe(60);
  });
});

describe("importing from the old issue tracker", () => {
  it("keeps the GitHub number as the id, so old links still resolve", async () => {
    const res = await store.upsertImportedWish("site", 22, draft({ title: "an old wish" }));
    expect(res!.id).toBe(22);
    expect(res!.created).toBe(true);
    expect((await store.findDbWish(22))!.title).toBe("an old wish");
  });

  it("updates on a second run instead of duplicating", async () => {
    const again = await store.upsertImportedWish("site", 22, draft({ title: "an old wish, edited" }));
    expect(again!.created).toBe(false);
    expect(again!.id).toBe(22);
    expect((await store.getDbWish("site", 22))!.title).toBe("an old wish, edited");
  });

  it("does not double the comment thread when re-run", async () => {
    const withThread = draft({
      title: "threaded",
      comments: [{ kind: "note", body: "hello", at: "2026-08-01T00:00:00Z" }],
    });
    const first = await store.upsertImportedWish("site", 43, withThread);
    await store.upsertImportedWish("site", 43, withThread);
    expect((await store.getDbWish("site", first!.id))!.comments).toHaveLength(1);
  });

  it("maps old issue numbers to new ids so parent links can be repointed", async () => {
    const map = await store.legacyIdMap("site");
    expect(map.get(22)).toBe(22);
    expect(map.get(43)).toBe(43);
  });

  it("repoints a parent link and can clear one", async () => {
    const parent = await store.upsertImportedWish("site", 50, draft({ title: "parent" }));
    const child = await store.upsertImportedWish("site", 51, draft({ title: "child", parentId: 50 }));

    await store.setParent("site", child!.id, parent!.id);
    expect((await store.getDbWish("site", child!.id))!.parentId).toBe(parent!.id);

    // A child whose parent was never imported must lose the link, not keep one
    // pointing at whatever wish happens to hold that number here.
    await store.setParent("site", child!.id, null);
    expect((await store.getDbWish("site", child!.id))!.parentId).toBeUndefined();
  });
});

describe("approval, through the module the API calls", () => {
  // The bug this guards: `approveWish` cleared `needsApproval` and nothing else.
  // That field is DERIVED from the stage in the store, so the patch lived only
  // in the returned object — the row kept `triage`, the next read said pending
  // again, the wish never left the review queue, and the loop (which refuses an
  // unapproved wish) never touched it. Approving looked like it worked.
  //
  // So the assertion that matters is the RE-READ, not the return value. A test
  // that only checked what approveWish handed back would have passed against
  // the broken version.
  let wishes: typeof import("../app/_platform/wishes");

  beforeAll(async () => {
    wishes = await import("../app/_platform/wishes");
  });

  it("a wish that needs approval is filed into triage", async () => {
    const w = await wishes.addWish({ scope: "site", title: "needs a look", needsApproval: true });
    expect(w.status).toBe("triage");
    expect((await store.getDbWish("site", w.id))!.needsApproval).toBe(true);
  });

  it("one that does not is ready immediately", async () => {
    const w = await wishes.addWish({ scope: "site", title: "straight through", needsApproval: false });
    expect(w.status).toBe("ready");
  });

  it("defaults to needing approval when the caller does not say", async () => {
    // A caller that never established who is asking has not earned an auto-yes.
    const w = await wishes.addWish({ scope: "site", title: "unattributed" });
    expect(w.status).toBe("triage");
  });

  it("APPROVING STICKS — the stage moves, and the re-read agrees", async () => {
    const w = await wishes.addWish({ scope: "site", title: "approve me", needsApproval: true });
    await wishes.approveWish(w.id, "an-admin");

    const back = await store.getDbWish("site", w.id);
    expect(back!.status).toBe("ready");
    expect(back!.needsApproval).toBe(false);
  });

  it("declining closes it, and keeps the reviewer's reason on the thread", async () => {
    const w = await wishes.addWish({ scope: "site", title: "decline me", needsApproval: true });
    await wishes.rejectWish(w.id, "an-admin", "already shipped last week");

    const back = await store.getDbWish("site", w.id);
    expect(back!.status).toBe("declined");
    expect(back!.closedAt).not.toBeNull();
    expect(back!.comments.at(-1)!.body).toContain("already shipped last week");
  });
});

describe("blocking, and the split that creates it", () => {
  // The point of `blockedBy` being a field rather than a stage: nothing has to
  // remember to unblock. These tests are written against that property — the
  // last one would fail on any implementation that stored "blocked" as a state.
  let wishes: typeof import("../app/_platform/wishes");
  let queue: typeof import("../app/_platform/queue");

  beforeAll(async () => {
    wishes = await import("../app/_platform/wishes");
    queue = await import("../app/_platform/queue");
  });

  it("keeps a blocked wish out of what the loop may pick up", async () => {
    const blocker = await wishes.addWish({ scope: "site", title: "platform half", needsApproval: false });
    const blocked = await wishes.addWish({ scope: "site", title: "product half", needsApproval: false, blockedBy: blocker.id });

    const ids = queue.workable([blocker, blocked]).map((w) => w.id);
    expect(ids).toContain(blocker.id);
    expect(ids).not.toContain(blocked.id);
  });

  it("FREES IT AUTOMATICALLY once the blocker closes — nothing un-blocks by hand", async () => {
    const blocker = await wishes.addWish({ scope: "site", title: "blocker", needsApproval: false });
    const blocked = await wishes.addWish({ scope: "site", title: "waiting", needsApproval: false, blockedBy: blocker.id });

    const shipped = { ...blocker, status: "done" as const };
    expect(queue.workable([shipped, blocked]).map((w) => w.id)).toContain(blocked.id);
    // …and the field is still set. It is a record of why it waited, not a state
    // that has to be cleaned up.
    expect(blocked.blockedBy).toBe(blocker.id);
  });

  it("does not strand a wish whose blocker cannot be found", async () => {
    // Wrong scope, deleted, bad id. An unresolvable blocker must not block for
    // ever with no visible reason.
    const orphan = await wishes.addWish({ scope: "site", title: "orphan", needsApproval: false, blockedBy: 999_999_999 });
    expect(queue.workable([orphan]).map((w) => w.id)).toContain(orphan.id);
    expect(queue.blockerOf([orphan], orphan)).toBeNull();
  });

  it("persists the blocker across a re-read", async () => {
    const blocker = await wishes.addWish({ scope: "site", title: "b", needsApproval: false });
    const w = await wishes.addWish({ scope: "site", title: "w", needsApproval: false });
    await wishes.blockWish(w.id, blocker.id, "tester");

    const back = await store.getDbWish("site", w.id);
    expect(back!.blockedBy).toBe(blocker.id);
    expect(back!.comments.at(-1)!.body).toContain(`#${blocker.id}`);
  });
});

describe("the content firewall", () => {
  let wishes: typeof import("../app/_platform/wishes");
  beforeAll(async () => { wishes = await import("../app/_platform/wishes"); });

  const others = ["inference-economics", "gtm"];

  it("splits — not refuses — when a product wish needs a platform change", async () => {
    // The whole reason this changed: a wrong split costs one click to decline,
    // a wrong refusal turns a real ask away.
    const v = wishes.governProductWish("ai-edu", "Fix the nav", "this lives in app/lib", others);
    expect(v.verdict).toBe("split");
  });

  it("still refuses a wish aimed at another product", async () => {
    // Cannot be split: the other half belongs on a board this filer may not
    // even be allowed to read.
    const v = wishes.governProductWish("ai-edu", "Copy inference-economics's layout", "", others);
    expect(v.verdict).toBe("refuse");
  });

  it("leaves an ordinary product wish alone", async () => {
    expect(wishes.governProductWish("ai-edu", "Dark mode", "the reader is bright", others).verdict).toBe("ok");
  });

  it("never governs a site wish — it is already where the platform lives", async () => {
    expect(wishes.governProductWish("site", "touch app/lib and every product", "", others).verdict).toBe("ok");
  });
});

describe("cost ceilings", () => {
  // Turso bills on rows READ far more than on storage, so the expensive thing is
  // not a big table — it is a big table multiplied by every page view. Both of
  // these bound that product.

  it("does not carry comment threads on a list", async () => {
    // The board never reads `.comments`; every consumer that does goes through
    // getDbWish for one wish. Stitching them onto a list meant reading the whole
    // comment table on every render, for nothing.
    const w = await store.createDbWish(draft({ title: "has a thread" }));
    await store.updateDbWish("site", w!.id, (x) => x, {
      kind: "note", body: "a comment", at: "2026-08-16T00:00:00Z",
    });

    const listed = (await store.listScopeWishes("site"))!.find((x) => x.id === w!.id);
    expect(listed!.comments).toEqual([]);

    // …and the single-wish read still has it.
    expect((await store.getDbWish("site", w!.id))!.comments).toHaveLength(1);
  });

  it("refuses to grow a product past its cap", async () => {
    const original = process.env.WISHES_MAX_PER_SCOPE;
    try {
      process.env.WISHES_MAX_PER_SCOPE = "1"; // already well past it
      await expect(store.createDbWish(draft({ title: "over the line" }))).rejects.toThrow(
        /WISHES_MAX_PER_SCOPE/,
      );
    } finally {
      if (original === undefined) delete process.env.WISHES_MAX_PER_SCOPE;
      else process.env.WISHES_MAX_PER_SCOPE = original;
    }
  });

  it("counts per product, so one cannot spend another's headroom", async () => {
    const original = process.env.WISHES_MAX_PER_SCOPE;
    try {
      // `site` is over the cap from the tests above; `gtm` has its own budget.
      process.env.WISHES_MAX_PER_SCOPE = "1";
      await expect(store.createDbWish(draft({ scope: "site" }))).rejects.toThrow();
      process.env.WISHES_MAX_PER_SCOPE = "10000";
      await expect(store.createDbWish(draft({ scope: "gtm", title: "fine" }))).resolves.not.toBeNull();
    } finally {
      if (original === undefined) delete process.env.WISHES_MAX_PER_SCOPE;
      else process.env.WISHES_MAX_PER_SCOPE = original;
    }
  });
});
