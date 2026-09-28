/**
 * validate-slides — the deck is the one artefact that LEAVES the site.
 *
 * A raw marker on a web page is a bug a reader can forgive: the link that should have
 * worked, didn't. The same marker in a .pptx is a bug that travels — into a deck someone
 * presents, with no site around it to explain itself. Six of them were shipping inside
 * every 11x deck ([[aisdr]], [[artisan]], [[decagon]], [[sierra]]), because `pills()` was
 * applied to every prose path and to no table cell, SWOT item, or formula note.
 *
 * This walks every entity in every product, builds its real deck, and fails on:
 *   - a surviving [[pill]]      — the resolver missed a slot
 *   - an odd `**` or backtick   — toPptx's inline parser leaves an unbalanced marker as
 *                                 literal text, and a single stray `*` is invisible to a
 *                                 "no raw **" check
 *
 * It deliberately does NOT fail on balanced `**` or backticks: toPptx turns them into
 * bold and code runs in prose blocks (inlineRuns) and strips them in table cells (plain).
 * Either way they are not debris.
 *
 * The parity check below is deck-GLOBAL, so two offsetting odd counts on different slides
 * would cancel. That is a backstop, not the primary gate: validate-content checks parity
 * per JSON field, which is where an unbalanced marker actually gets written.
 */
import { deckFromEntity } from "../app/_platform/slides/fromEntity";
import { loadEntities } from "../app/_platform/research/engine";
import { productsWithResearch } from "./_scan";

const errors: string[] = [];
let decks = 0;

for (const product of productsWithResearch()) {
  const entities = loadEntities(product);
  const names = new Map(entities.map((e) => [e.slug, e.name]));
  for (const e of entities) {
    decks += 1;
    const md = deckFromEntity(e, product, names);
    for (const pill of md.match(/\[\[[a-z0-9-]+\]\]/g) ?? [])
      errors.push(`[${product}] ${e.slug}: ${pill} reaches the deck unresolved`);
    if (((md.match(/\*\*/g) ?? []).length) % 2 !== 0)
      errors.push(`[${product}] ${e.slug}: odd count of \`**\` — it lands in the .pptx as literal text`);
    if (((md.match(/`/g) ?? []).length) % 2 !== 0)
      errors.push(`[${product}] ${e.slug}: odd count of backticks — it lands in the .pptx as literal text`);
  }
}

console.log(`  ✓ ${decks} decks built across ${productsWithResearch().length} products`);
if (errors.length) {
  console.error(`\n✗ validate-slides: ${errors.length} error(s)\n` + errors.slice(0, 20).map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log("✓ validate-slides: no raw marker reaches a deck");
