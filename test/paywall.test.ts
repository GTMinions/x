/**
 * The paywall switch.
 *
 * The property worth defending is which way it fails. A gate that opens when
 * the settings table is unreachable is not a gate — so the default and the
 * error path both leave the wall standing, and only an explicit "off" written
 * by an admin takes it down.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `x-test-paywall-${process.pid}.db`);
process.env.ACCOUNTS_DATABASE_URL = `file:${DB}`;

let settings: typeof import("../app/lib/settings");

/** The settings cache holds for a few seconds; a test that flips a switch has
 *  to wait it out or it reads its own stale value. */
const wait = () => new Promise((r) => setTimeout(r, 5_500));

beforeAll(async () => {
  settings = await import("../app/lib/settings");
  return () => rmSync(DB, { force: true });
});

describe("which way it fails", () => {
  it("STANDS BY DEFAULT — an unconfigured deployment is not an open one", async () => {
    expect(await settings.paywallOn()).toBe(true);
  });

  it("comes down only when an admin writes it off", async () => {
    await settings.setPaywall(false, "test");
    await wait();
    expect(await settings.paywallOn()).toBe(false);
  }, 20_000);

  it("goes back up, and the switch is not one-way", async () => {
    await settings.setPaywall(true, "test");
    await wait();
    expect(await settings.paywallOn()).toBe(true);
  }, 20_000);

  it("treats any value that is not the word off as on", async () => {
    // A half-written row, a typo, a value from a future version: none of them
    // should silently let everybody through.
    await settings.setSetting(settings.PAYWALL_KEY, "maybe", "test");
    await wait();
    expect(await settings.paywallOn()).toBe(true);
  }, 20_000);
});
