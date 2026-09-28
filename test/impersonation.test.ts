/**
 * Viewing the site as another user.
 *
 * This is a support tool that hands one person another person's screen, so the
 * tests are written against the ways it must NOT work:
 *
 *   The cookie alone is worth nothing. Standing is re-derived from the real
 *   session on every read, so a leaked cookie, or an admin who was demoted an
 *   hour ago, borrows nothing.
 *
 *   The borrowed session carries no scopes. An admin looking through a user's
 *   eyes must see the user's page — including what it refuses — or the tool
 *   answers a different question than the one asked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
let realSession: { email: string; scopes: string[] } | null = null;
let accountsByEmail: Record<string, { id: number; externalId: string; primaryEmail: string; displayName: string | null; accountType: string }> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (cookieJar.has(k) ? { value: cookieJar.get(k)! } : undefined) }),
}));

vi.mock("../app/lib/auth", () => ({
  getSession: async () => realSession,
  // The real predicate's shape: a site admin carries a bare/wildcard admin scope.
  isSiteAdmin: (s: { scopes?: string[] } | null) =>
    !!s?.scopes?.some((x) => x === "admin" || x === "admin:*" || x === "owner"),
}));

vi.mock("../app/lib/identity/accounts", () => ({
  findAccountByEmail: async (e: string) => accountsByEmail[e.toLowerCase()] ?? null,
}));

let imp: typeof import("../app/lib/impersonation");

beforeEach(async () => {
  cookieJar.clear();
  realSession = null;
  accountsByEmail = {
    "user@example.com": { id: 2, externalId: "ext-user", primaryEmail: "user@example.com", displayName: "A User", accountType: "consumer" },
  };
  imp = await import("../app/lib/impersonation");
});

const asAdmin = () => (realSession = { email: "admin@example.com", scopes: ["admin"] });
const asUser = () => (realSession = { email: "someone@example.com", scopes: [] });
const borrow = (e: string) => cookieJar.set(imp.IMPERSONATE_COOKIE, e);

describe("who may borrow a view", () => {
  it("a site admin with the cookie borrows the view", async () => {
    asAdmin();
    borrow("user@example.com");
    expect((await imp.viewingAs())?.email).toBe("user@example.com");
  });

  it("IGNORES THE COOKIE for a non-admin — it is worth nothing on its own", async () => {
    asUser();
    borrow("user@example.com");
    expect(await imp.viewingAs()).toBeNull();
  });

  it("ignores it for a signed-out visitor", async () => {
    realSession = null;
    borrow("user@example.com");
    expect(await imp.viewingAs()).toBeNull();
  });

  it("EVAPORATES when the admin loses standing, with nothing to clean up", async () => {
    asAdmin();
    borrow("user@example.com");
    expect(await imp.viewingAs()).not.toBeNull();

    // Same cookie, same browser — the account is simply no longer an admin.
    realSession = { email: "admin@example.com", scopes: [] };
    expect(await imp.viewingAs()).toBeNull();
  });

  it("treats borrowing your own view as no borrowing at all", async () => {
    asAdmin();
    borrow("admin@example.com");
    expect(await imp.viewingAs()).toBeNull();
  });
});

describe("the borrowed session", () => {
  it("renders as the user, and CARRIES NO SCOPES", async () => {
    asAdmin();
    borrow("user@example.com");
    const s = await imp.readingSession();
    expect(s?.email).toBe("user@example.com");
    // The load-bearing assertion: with scopes, the admin would see their own
    // page wearing somebody else's name.
    expect(s?.scopes).toEqual([]);
  });

  it("falls back to the real session when the borrowed account does not exist", async () => {
    asAdmin();
    borrow("ghost@example.com");
    expect((await imp.readingSession())?.email).toBe("admin@example.com");
  });

  it("is just the real session when nothing is borrowed", async () => {
    asAdmin();
    expect((await imp.readingSession())?.email).toBe("admin@example.com");
  });
});
