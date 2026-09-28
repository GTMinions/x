/**
 * Who files straight into the queue, and whose wish waits.
 *
 * This is an authorisation rule, so the test that matters is the negative one:
 * the cases that must NOT auto-approve. A rule that says yes when it should say
 * no puts unreviewed work in front of the loop; a rule that says no when it
 * should say yes only annoys an admin, who can then approve it by hand.
 *
 * The old gate this replaced read the wording of a request. There is a test
 * below for that specifically — the same wish, filed by two people, must get
 * two different answers, and the same person filing two very different wishes
 * must get the same one.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const IDENTITY = join(tmpdir(), `x-test-approval-${process.pid}.db`);
process.env.ACCOUNTS_DATABASE_URL = `file:${IDENTITY}`;
// A bootstrap admin the test owns, rather than whoever happens to run production.
process.env.SITE_ADMIN_EMAILS = "boss@example.com";

let approval: typeof import("../app/lib/approval");
let memberships: typeof import("../app/lib/memberships");

const SITE_ADMIN = "boss@example.com";
const PRODUCT_ADMIN = "pa@example.com";
const PRODUCT_EDITOR = "pe@example.com";
const TEAM_ADMIN = "ta@example.com";
const NOBODY = "nobody@example.com";

beforeAll(async () => {
  approval = await import("../app/lib/approval");
  memberships = await import("../app/lib/memberships");

  // ai-edu is the demo product; its owning team is growth-labs.
  await memberships.setMembership(PRODUCT_ADMIN, "product", "ai-edu", "admin");
  await memberships.setMembership(PRODUCT_EDITOR, "product", "ai-edu", "editor");
  await memberships.setMembership(TEAM_ADMIN, "team", "growth-labs", "admin");

  return () => rmSync(IDENTITY, { force: true });
});

describe("who may approve", () => {
  it("a product admin approves their own product", async () => {
    expect(await approval.canApproveScope(PRODUCT_ADMIN, "ai-edu")).toBe(true);
  });

  it("…and NOT another product", async () => {
    // The whole point of per-product admins. A grant on one board is not a
    // grant on the next one.
    expect(await approval.canApproveScope(PRODUCT_ADMIN, "inference-economics")).toBe(false);
  });

  it("…and NOT the platform", async () => {
    // A site wish is a change to the spine every product inherits. Being able
    // to run one product is not authority over all of them.
    expect(await approval.canApproveScope(PRODUCT_ADMIN, "site")).toBe(false);
  });

  it("an editor cannot approve", async () => {
    // Editing content and deciding what gets built are different powers, and
    // this is the boundary between them.
    expect(await approval.canApproveScope(PRODUCT_EDITOR, "ai-edu")).toBe(false);
  });

  it("the owning team's admin can", async () => {
    // roleAtLeast does not cascade team → product on its own, so without an
    // explicit check the admin of the team that OWNS a product would be locked
    // out of approving wishes against it.
    expect(await approval.canApproveScope(TEAM_ADMIN, "ai-edu")).toBe(true);
  });

  it("a site admin approves everywhere", async () => {
    for (const scope of ["site", "ai-edu", "inference-economics", "gtm"]) {
      expect(await approval.canApproveScope(SITE_ADMIN, scope), scope).toBe(true);
    }
  });

  it("a signed-out filer approves nothing", async () => {
    expect(await approval.canApproveScope(null, "ai-edu")).toBe(false);
    expect(await approval.canApproveScope(undefined, "site")).toBe(false);
    expect(await approval.canApproveScope("", "site")).toBe(false);
  });

  it("a stranger with an account approves nothing", async () => {
    expect(await approval.canApproveScope(NOBODY, "ai-edu")).toBe(false);
  });
});

describe("what needs approval", () => {
  it("is exactly the inverse, so the two can never disagree", async () => {
    for (const [who, scope] of [
      [PRODUCT_ADMIN, "ai-edu"], [PRODUCT_ADMIN, "site"],
      [NOBODY, "ai-edu"], [SITE_ADMIN, "gtm"], [null, "site"],
    ] as const) {
      expect(await approval.wishNeedsApproval(who, scope)).toBe(!(await approval.canApproveScope(who, scope)));
    }
  });

  it("does not depend on what the wish says", async () => {
    // The rule this replaced read the request: length, bullet count, keywords.
    // It once refused the wish asking for its own removal, because the word
    // "approval" was in that wish's title. Nothing here can see the text at
    // all, which is the property under test — the signature takes no wish.
    expect(await approval.wishNeedsApproval(PRODUCT_ADMIN, "ai-edu")).toBe(false);
    expect(await approval.wishNeedsApproval(NOBODY, "ai-edu")).toBe(true);
  });
});

describe("the review queue's scope list", () => {
  it("gives a product admin only their product", async () => {
    expect(await approval.approvableScopes(PRODUCT_ADMIN)).toEqual(["ai-edu"]);
  });

  it("gives a site admin every scope, site included", async () => {
    const scopes = await approval.approvableScopes(SITE_ADMIN);
    expect(scopes).toContain("site");
    expect(scopes).toContain("ai-edu");
    expect(scopes.length).toBeGreaterThan(2);
  });

  it("gives an editor and a stranger nothing", async () => {
    expect(await approval.approvableScopes(PRODUCT_EDITOR)).toEqual([]);
    expect(await approval.approvableScopes(NOBODY)).toEqual([]);
    expect(await approval.approvableScopes(null)).toEqual([]);
  });
});
