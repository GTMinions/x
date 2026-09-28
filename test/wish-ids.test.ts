/**
 * Wish ids: global, random, and free to mint.
 *
 * Two properties, and they pull against each other. Ids must be unique across
 * four separate databases that never talk to one another — and minting one must
 * not cost a query per product, which is what the first implementation did
 * (COUNT + SELECT per product, nine round trips per wish).
 *
 * Partitioning is what resolves it: each product draws inside its own block, so
 * cross-product uniqueness is a property of the LAYOUT rather than something
 * verified at runtime. That only holds while the blocks stay disjoint and every
 * product has one, so those are the assertions worth having.
 */
import { describe, expect, it } from "vitest";
import {
  MINT_ATTEMPTS,
  WISH_ID_BLOCKS,
  WISH_ID_FLOOR,
  blockFor,
  blockRange,
  mintWishId,
  scopeOfId,
  unassignedScopes,
} from "../app/_platform/wishes/ids";
// The scopes the code table ships with. A product created at runtime gets its
// block from the registry (app/lib/registry/core.ts) and is not in this list.
const SCOPES = ["site", "ai-edu", "inference-economics", "gtm"];

describe("the block table", () => {
  it("assigns a block to every scope, site included", () => {
    expect(unassignedScopes(SCOPES)).toEqual([]);
  });

  it("never gives two scopes the same block", () => {
    // Reusing a number lets a new product mint an id an old wish already holds,
    // in a different database, where no constraint can catch it.
    const blocks = SCOPES.map((s) => blockFor(s));
    expect(new Set(blocks).size).toBe(SCOPES.length);
  });

  it("reports a scope that was added without a block", () => {
    expect(unassignedScopes([...SCOPES, "brand-new"])).toEqual(["brand-new"]);
  });
});

describe("minting", () => {
  it("keeps every draw inside its own product's range", () => {
    for (const scope of SCOPES) {
      const { min, max } = blockRange(scope);
      for (let i = 0; i < 400; i++) {
        const id = mintWishId(scope);
        expect(id, `${scope} drew ${id}, outside ${min}–${max}`).toBeGreaterThanOrEqual(min);
        expect(id).toBeLessThanOrEqual(max);
      }
    }
  });

  it("cannot produce the same id for two different products", () => {
    // The whole safety argument in one assertion: disjoint by construction,
    // not by checking.
    const drawn = new Map<string, Set<number>>();
    for (const scope of SCOPES) {
      drawn.set(scope, new Set(Array.from({ length: 500 }, () => mintWishId(scope))));
    }
    for (const a of SCOPES) {
      for (const b of SCOPES) {
        if (a === b) continue;
        const overlap = [...drawn.get(a)!].filter((id) => drawn.get(b)!.has(id));
        expect(overlap, `${a} and ${b} overlap at ${overlap[0]}`).toEqual([]);
      }
    }
  });

  it("stays clear of the range imported wishes occupy", () => {
    // Imported wishes keep their old GitHub issue number, which is small.
    // Generated ids must never reach down into it.
    for (const scope of SCOPES) {
      for (let i = 0; i < 200; i++) expect(mintWishId(scope)).toBeGreaterThanOrEqual(WISH_ID_FLOOR);
    }
  });

  it("does not hand out consecutive numbers", () => {
    const ids = Array.from({ length: 500 }, () => mintWishId("gtm"));
    expect(new Set(ids).size).toBeGreaterThan(480);
    // A counter would produce a perfectly ascending run; random draws will not.
    const ascending = ids.every((id, i) => i === 0 || id === ids[i - 1]! + 1);
    expect(ascending).toBe(false);
  });

  it("leaves room to retry before giving up", () => {
    expect(MINT_ATTEMPTS).toBeGreaterThan(1);
  });
});

describe("reading an id back", () => {
  it("names the product an id belongs to", () => {
    for (const scope of SCOPES) expect(scopeOfId(mintWishId(scope))).toBe(scope);
  });

  it("returns null for an imported wish rather than guessing", () => {
    expect(scopeOfId(22)).toBeNull();
    expect(scopeOfId(1)).toBeNull();
  });

  it("returns null for a block nobody owns", () => {
    const unused = Math.max(...Object.values(WISH_ID_BLOCKS)) + 5;
    expect(scopeOfId(unused * 100_000 + 1)).toBeNull();
  });
});
