/**
 * Who may read which product.
 *
 * This is the suite that most needs to exist. `visibility` sat on `Product`
 * unread for the whole life of the registry, so every signed-in user could open
 * every product and the cross-scope wish board showed everyone everything.
 * Nothing failed; it just quietly did the wrong thing.
 *
 * A regression here looks exactly the same: green build, working site, other
 * people's data on screen. So these assertions are about the FACTS a reader
 * can reach, not about which function was called.
 *
 * The registry is a database; here it is a fixture (PRODUCT_REGISTRY_FIXTURE)
 * with the shape production carries: one public demo, the rest private.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `x-test-access-${process.pid}.db`);
process.env.ACCOUNTS_DATABASE_URL = `file:${DB}`;
process.env.SITE_ADMIN_EMAILS = "boss@example.com";

const FIXTURE = [
  { slug: "ai-edu", teamSlug: "growth-labs", name: "Atlas Learn", tagline: "", accent: "#356a4d", status: "active", visibility: "private", hasResearch: true },
  { slug: "inference-economics", teamSlug: "growth-labs", name: "Inference Economics", tagline: "", accent: "#9A2F66", status: "active", visibility: "public", hasResearch: false },
  { slug: "gtm", teamSlug: "growth-labs", name: "Second Product", tagline: "", accent: "#a4553a", status: "active", visibility: "private", hasResearch: true },
];
process.env.PRODUCT_REGISTRY_FIXTURE = JSON.stringify(FIXTURE);
const DEMO = "inference-economics";
const ALL = FIXTURE.map((p) => p.slug);

const STRANGER = "stranger@example.com";
const PRODUCT_MEMBER = "member@example.com";
const TEAM_MEMBER = "team@example.com";
const ADMIN = "boss@example.com";

let access: typeof import("../app/lib/access");
let products: typeof import("../app/lib/products");

beforeAll(async () => {
  const memberships = await import("../app/lib/memberships");
  access = await import("../app/lib/access");
  products = await import("../app/lib/products");

  await memberships.setMembership(PRODUCT_MEMBER, "product", "gtm", "reader");
  await memberships.setMembership(TEAM_MEMBER, "team", "growth-labs", "reader");

  return () => rmSync(DB, { force: true });
});

describe("the registry's own declaration", () => {
  it("marks exactly one product public — the demo", async () => {
    const open = (await products.listProducts()).filter((p) => p.visibility === "public").map((p) => p.slug);
    expect(open).toEqual([DEMO]);
  });

  it("defaults everything else to private, not unlisted", async () => {
    // `unlisted` is still readable by anyone with the link. A product that is
    // merely unlisted when it was meant to be private is the failure this
    // assertion exists to catch, and it is invisible by inspection.
    for (const p of await products.listProducts()) {
      if (p.slug === DEMO) continue;
      expect(p.visibility, `${p.slug} must be private, not ${p.visibility}`).toBe("private");
    }
  });

  it("listProducts() is the registry and filters nothing", async () => {
    expect((await products.listProducts()).map((p) => p.slug)).toEqual(ALL);
  });
});

describe("reading a product", () => {
  it("lets any signed-in stranger read the demo", async () => {
    await expect(access.canReadProduct(STRANGER, DEMO)).resolves.toBe(true);
  });

  it("refuses a stranger on every private product", async () => {
    await expect(access.canReadProduct(STRANGER, "gtm")).resolves.toBe(false);
    await expect(access.canReadProduct(STRANGER, "ai-edu")).resolves.toBe(false);
  });

  it("opens the one product a grant names, and no others", async () => {
    await expect(access.canReadProduct(PRODUCT_MEMBER, "gtm")).resolves.toBe(true);
    await expect(access.canReadProduct(PRODUCT_MEMBER, "ai-edu")).resolves.toBe(false);
  });

  it("lets a TEAM grant reach that team's products", async () => {
    // `roleAtLeast` does not cascade team → product on its own; only site admin
    // is global. Without the explicit team check in canReadProduct, the owners
    // of a product are locked out of their own work.
    await expect(access.canReadProduct(TEAM_MEMBER, "gtm")).resolves.toBe(true);
    await expect(access.canReadProduct(TEAM_MEMBER, "ai-edu")).resolves.toBe(true);
  });

  it("lets a site admin read everything", async () => {
    for (const slug of ALL) await expect(access.canReadProduct(ADMIN, slug)).resolves.toBe(true);
  });

  it("refuses a signed-out visitor on a private product", async () => {
    await expect(access.canReadProduct(null, "gtm")).resolves.toBe(false);
    await expect(access.canReadProduct(undefined, "gtm")).resolves.toBe(false);
  });

  it("refuses an unknown slug even for an admin", async () => {
    await expect(access.canReadProduct(ADMIN, "no-such-product")).resolves.toBe(false);
  });
});

describe("the directory", () => {
  it("shows an anonymous visitor only the demo", async () => {
    const seen = (await access.listableProducts(undefined)).map((p) => p.slug);
    expect(seen).toEqual([DEMO]);
  });

  it("shows a member the demo plus what they were granted", async () => {
    const seen = (await access.listableProducts(PRODUCT_MEMBER)).map((p) => p.slug).sort();
    expect(seen).toEqual([DEMO, "gtm"].sort());
  });

  it("shows an admin everything", async () => {
    const seen = await access.listableProducts(ADMIN);
    expect(seen).toHaveLength(ALL.length);
  });
});

describe("wish scopes — the cross-product board", () => {
  it("gives a stranger site plus the demo, and nothing else", async () => {
    const scopes = (await access.readableScopes(STRANGER)).sort();
    expect(scopes).toEqual([DEMO, "site"].sort());
  });

  it("always includes site, even signed out", async () => {
    // `site` is common ground: the wish form is how someone asks for anything,
    // including access to a product they cannot yet read.
    await expect(access.readableScopes(null)).resolves.toContain("site");
  });
});

describe("wish scopes — leaks", () => {
  it("does not leak a private scope to someone without a grant", async () => {
    const scopes = await access.readableScopes(PRODUCT_MEMBER);
    expect(scopes).toContain("gtm");
    expect(scopes).not.toContain("ai-edu");
  });
});

describe("the refusal", () => {
  it("says private, and names the product, so the reader knows who to ask", async () => {
    const d = await access.readProductOrDenial(STRANGER, "gtm");
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("private");
    // Naming it is deliberate: the codebase is open source, so hiding existence
    // protects nothing a `git clone` does not already reveal.
    expect(d.product?.name).toBe("Second Product");
  });

  it("distinguishes an unknown product from a forbidden one", async () => {
    const d = await access.readProductOrDenial(ADMIN, "no-such-product");
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe("unknown");
  });
});
