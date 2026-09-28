/** build-search-index — emit public/search-index.json (per-product docs). */
import fs from "node:fs";
import path from "node:path";
import { buildSearchIndex } from "../app/_platform/research/engine";
import { productsWithResearch } from "./_scan";

const out: Record<string, ReturnType<typeof buildSearchIndex>> = {};
for (const product of productsWithResearch()) {
  out[product] = buildSearchIndex(product);
  console.log(`  ✓ ${product}: ${out[product].length} docs`);
}

const pub = path.join(process.cwd(), "public");
fs.mkdirSync(pub, { recursive: true });
fs.writeFileSync(path.join(pub, "search-index.json"), JSON.stringify(out, null, 2));
console.log("✓ build-search-index → public/search-index.json");
