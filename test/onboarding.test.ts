/**
 * The onboarding rules that decide who may change the site before anyone can
 * sign in: local single-user, the owner proof, and the provider table.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isLocalSingleUser, ownerProof } from "@/app/lib/onboarding";
import { DATABASES, HOSTS, IMPOSSIBLE, detectDatabase, detectHost, missingKeys } from "@/app/lib/providers";

const saved = { ...process.env };
afterEach(() => {
  for (const k of ["VERCEL", "X_SINGLE_USER", "NODE_ENV", "VERCEL_TOKEN", "TURSO_API_TOKEN", "TURSO_ORG", "PRODUCT_DB_SITE_URL"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("local single-user", () => {
  it("is on for localhost on a computer-hosted site", () => {
    delete process.env.VERCEL;
    delete process.env.X_SINGLE_USER;
    expect(isLocalSingleUser("localhost:4000")).toBe(true);
    expect(isLocalSingleUser("127.0.0.1:4000")).toBe(true);
    expect(isLocalSingleUser("[::1]:4000")).toBe(true);
    expect(isLocalSingleUser("LOCALHOST")).toBe(true);
  });
  it("is off for any other hostname", () => {
    delete process.env.VERCEL;
    expect(isLocalSingleUser("example.com")).toBe(false);
    expect(isLocalSingleUser("localhost.evil.com")).toBe(false);
    expect(isLocalSingleUser("192.168.1.10:4000")).toBe(false);
    expect(isLocalSingleUser("")).toBe(false);
    expect(isLocalSingleUser(null)).toBe(false);
  });
  it("is off on Vercel, whatever the Host header says", () => {
    process.env.VERCEL = "1";
    expect(isLocalSingleUser("localhost:4000")).toBe(false);
  });
  it("is off when the owner asks for sign-in", () => {
    delete process.env.VERCEL;
    process.env.X_SINGLE_USER = "0";
    expect(isLocalSingleUser("localhost:4000")).toBe(false);
  });
  it("is off in a production build unless switched on, because a reverse proxy can rewrite Host", () => {
    delete process.env.VERCEL;
    delete process.env.X_SINGLE_USER;
    (process.env as Record<string, string>).NODE_ENV = "production";
    expect(isLocalSingleUser("localhost:4000")).toBe(false);
    process.env.X_SINGLE_USER = "1";
    expect(isLocalSingleUser("localhost:4000")).toBe(true);
    process.env.X_SINGLE_USER = "0";
    expect(isLocalSingleUser("localhost:4000")).toBe(false);
  });
});

describe("owner proof", () => {
  it("accepts exactly the host key", () => {
    process.env.VERCEL_TOKEN = "tok_abc123";
    expect(ownerProof("tok_abc123")).toBe(true);
    expect(ownerProof("tok_abc124")).toBe(false);
    expect(ownerProof("tok_abc12")).toBe(false);
    expect(ownerProof("")).toBe(false);
    expect(ownerProof(undefined)).toBe(false);
  });
  it("never accepts anything when there is no host key", () => {
    delete process.env.VERCEL_TOKEN;
    expect(ownerProof("")).toBe(false);
    expect(ownerProof("anything")).toBe(false);
  });
});

describe("providers", () => {
  it("names a host and a database for every environment", () => {
    delete process.env.VERCEL;
    delete process.env.TURSO_API_TOKEN;
    delete process.env.TURSO_ORG;
    delete process.env.PRODUCT_DB_SITE_URL;
    expect(detectHost()).toBe("computer");
    expect(detectDatabase()).toBe("sqlite");
    process.env.VERCEL = "1";
    process.env.TURSO_API_TOKEN = "t";
    process.env.TURSO_ORG = "o";
    expect(detectHost()).toBe("vercel");
    expect(detectDatabase()).toBe("turso");
    process.env.PRODUCT_DB_SITE_URL = "libsql://x";
    expect(detectDatabase()).toBe("named");
  });
  it("lists what each provider needs before anything else can happen", () => {
    delete process.env.VERCEL_TOKEN;
    delete process.env.TURSO_API_TOKEN;
    delete process.env.TURSO_ORG;
    expect(missingKeys(HOSTS.find((h) => h.id === "computer")!)).toEqual([]);
    expect(missingKeys(HOSTS.find((h) => h.id === "vercel")!).map((k) => k.name)).toEqual(["VERCEL_TOKEN"]);
    expect(missingKeys(DATABASES.find((d) => d.id === "sqlite")!)).toEqual([]);
    expect(missingKeys(DATABASES.find((d) => d.id === "turso")!).map((k) => k.name)).toEqual(["TURSO_API_TOKEN", "TURSO_ORG"]);
  });
  it("refuses only the pair that cannot work", () => {
    expect(IMPOSSIBLE).toEqual([expect.objectContaining({ host: "vercel", database: "sqlite" })]);
    for (const { host, database } of IMPOSSIBLE) {
      expect(HOSTS.some((h) => h.id === host)).toBe(true);
      expect(DATABASES.some((d) => d.id === database)).toBe(true);
    }
  });
});

describe("payment mode: the session override", () => {
  const configured = (m: "test" | "live") => m === "test" || m === "live";
  const onlyTest = (m: "test" | "live") => m === "test";
  it("follows the site's switch when nobody is overriding", async () => {
    const { resolveStripeMode } = await import("@/app/lib/stripe");
    expect(resolveStripeMode({ site: "live", override: null, isAdmin: true, configured })).toEqual({ mode: "live", source: "site" });
    expect(resolveStripeMode({ site: "test", override: undefined, isAdmin: false, configured })).toEqual({ mode: "test", source: "site" });
  });
  it("lets a site admin's own browser use the other Stripe", async () => {
    const { resolveStripeMode } = await import("@/app/lib/stripe");
    expect(resolveStripeMode({ site: "live", override: "test", isAdmin: true, configured })).toEqual({ mode: "test", source: "session" });
    expect(resolveStripeMode({ site: "test", override: "live", isAdmin: true, configured })).toEqual({ mode: "live", source: "session" });
  });
  it("ignores the cookie for anyone who is not a site admin — a non-admin could otherwise buy live through the sandbox", async () => {
    const { resolveStripeMode } = await import("@/app/lib/stripe");
    expect(resolveStripeMode({ site: "live", override: "test", isAdmin: false, configured })).toEqual({ mode: "live", source: "site" });
  });
  it("ignores an override pointing at a mode with no keys, and any value that is not a mode", async () => {
    const { resolveStripeMode } = await import("@/app/lib/stripe");
    expect(resolveStripeMode({ site: "test", override: "live", isAdmin: true, configured: onlyTest })).toEqual({ mode: "test", source: "site" });
    expect(resolveStripeMode({ site: "test", override: "LIVE", isAdmin: true, configured })).toEqual({ mode: "test", source: "site" });
  });
});
