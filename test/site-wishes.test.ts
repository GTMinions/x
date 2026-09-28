/**
 * Who may read a platform wish.
 *
 * Site wishes were world-readable to anyone signed in, because `readableScopes`
 * always includes `site` and nothing looked past the scope. That is backwards:
 * a product's wishes were gated the day `visibility` started being enforced,
 * and the platform — the one thing every product inherits — was not.
 *
 * The tests below are almost all negative. A rule like this is only worth
 * anything if it says NO to the right people; saying yes is the easy half.
 */
import { beforeAll, describe, expect, it } from "vitest";

// This suite's registry: ai-edu is the public demo and inference-economics the private
// product a stranger must not see through. (The default fixture has it the
// other way round; the setup file only fills the variable when it is empty.)
process.env.PRODUCT_REGISTRY_FIXTURE = JSON.stringify([
  { slug: "ai-edu", teamSlug: "growth-labs", name: "Atlas Learn", tagline: "", accent: "#356a4d", status: "active", visibility: "public", hasResearch: true },
  { slug: "inference-economics", teamSlug: "growth-labs", name: "Inference Economics", tagline: "", accent: "#5a4fcf", status: "active", visibility: "private", hasResearch: true },
  { slug: "gtm", teamSlug: "growth-labs", name: "Second Product", tagline: "", accent: "#a4553a", status: "active", visibility: "private", hasResearch: true },
]);
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const IDENTITY = join(tmpdir(), `x-test-sitewish-${process.pid}.db`);
process.env.ACCOUNTS_DATABASE_URL = `file:${IDENTITY}`;
process.env.SITE_ADMIN_EMAILS = "boss@example.com";
const SITE_DB = join(tmpdir(), `x-test-sitewish-store-${process.pid}.db`);
process.env.PRODUCT_DB_SITE_URL = `file:${SITE_DB}`;

let access: typeof import("../app/lib/access");
let memberships: typeof import("../app/lib/memberships");

const SITE_ADMIN = "boss@example.com";
const AI_EDU_READER = "reader@example.com";
const STRANGER = "nobody@example.com";

/** The shapes the filter actually sees. */
const internal = { id: 1, scope: "site" };
const splitFromAiEdu = { id: 2, scope: "site", originScope: "ai-edu" };
const published = { id: 3, scope: "site", publicWish: true };
const productWish = { id: 4, scope: "ai-edu" };

beforeAll(async () => {
  access = await import("../app/lib/access");
  memberships = await import("../app/lib/memberships");
  await memberships.setMembership(AI_EDU_READER, "product", "ai-edu", "reader");
  return () => { rmSync(IDENTITY, { force: true }); rmSync(SITE_DB, { force: true }); };
});

describe("a stranger", () => {
  it("cannot see an internal platform wish", async () => {
    const visible = await access.siteWishFilter(STRANGER, new Set());
    expect(visible(internal)).toBe(false);
  });

  it("cannot see one split out of a product they can't read", async () => {
    // ai-edu is the public demo, so pick the private one for this.
    const visible = await access.siteWishFilter(STRANGER, new Set());
    expect(visible({ id: 9, scope: "site", originScope: "inference-economics" })).toBe(false);
  });

  it("CAN see one an admin published", async () => {
    // The window that keeps the board from going dark for a newcomer.
    const visible = await access.siteWishFilter(STRANGER, new Set());
    expect(visible(published)).toBe(true);
  });

  it("can always see a wish they filed themselves", async () => {
    // A wish you cannot follow is worse than one you never filed.
    const visible = await access.siteWishFilter(STRANGER, new Set([internal.id]));
    expect(visible(internal)).toBe(true);
  });
});

describe("a product reader", () => {
  it("sees the platform half of their product's ask", async () => {
    const visible = await access.siteWishFilter(AI_EDU_READER, new Set());
    expect(visible(splitFromAiEdu)).toBe(true);
  });

  it("…but not unrelated platform work", async () => {
    const visible = await access.siteWishFilter(AI_EDU_READER, new Set());
    expect(visible(internal)).toBe(false);
  });

  it("…and not the platform half of a product they can't read", async () => {
    const visible = await access.siteWishFilter(AI_EDU_READER, new Set());
    expect(visible({ id: 10, scope: "site", originScope: "inference-economics" })).toBe(false);
  });
});

describe("a site admin", () => {
  it("sees everything", async () => {
    const visible = await access.siteWishFilter(SITE_ADMIN, new Set());
    for (const w of [internal, splitFromAiEdu, published]) expect(visible(w)).toBe(true);
  });
});

describe("publishing", () => {
  let wishes: typeof import("../app/_platform/wishes");
  beforeAll(async () => { wishes = await import("../app/_platform/wishes"); });

  it("flips visibility for a stranger, and flips back", async () => {
    // The whole point of the flag: one reviewer decision moves a wish across
    // the boundary, and moves it back if they change their mind.
    const w = { id: 77, scope: "site" } as { id: number; scope: string; publicWish?: boolean };
    const visible = await access.siteWishFilter(STRANGER, new Set());
    expect(visible(w)).toBe(false);
    expect(visible({ ...w, publicWish: true })).toBe(true);
  });

  it("writes the change to the thread so the filer can see who did it", async () => {
    const w = await wishes.addWish({ scope: "site", title: "publish me", needsApproval: false });
    await wishes.setWishPublic(w.id, true, "an-admin");
    const shown = await wishes.getWish(w.id, "site");
    expect(shown!.publicWish).toBe(true);
    expect(shown!.comments.at(-1)!.body).toMatch(/Published/);

    await wishes.setWishPublic(w.id, false, "an-admin");
    const hidden = await wishes.getWish(w.id, "site");
    expect(hidden!.publicWish).toBeFalsy();
    expect(hidden!.comments.at(-1)!.body).toMatch(/Unpublished/);
  });
});

describe("scopes other than site", () => {
  it("are left alone — their own product gate already ruled", async () => {
    // Double-gating here would silently hide product wishes the product's own
    // access rule had already allowed.
    for (const who of [STRANGER, AI_EDU_READER, SITE_ADMIN]) {
      const visible = await access.siteWishFilter(who, new Set());
      expect(visible(productWish), who).toBe(true);
    }
  });
});
