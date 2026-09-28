/**
 * Slides — turn a research entity into a presentable, exportable deck.
 *
 * The generator is deterministic: it derives the deck from the entity schema
 * rather than from a model. x has no LLM key and no backend, and this feature
 * needs neither, because a researched entity is already a deck outline —
 * abstract → background → mechanism → components → benchmarks → discussion →
 * conclusion, each section led by the claim it defends.
 *
 *   model.ts        deck = Markdown, slides split on `---`; parse + render
 *   fromEntity.ts   Entity → deck Markdown (the generator; handles MOCs too)
 *   toPptx.ts       deck Markdown → .pptx bytes (pptxgenjs, no network)
 *   SlidesViewer    the client viewer (plain CSS, keyboard nav)
 *   SlidesPage      the server page — a product route is three lines
 *   SlidesLink      the "Present" affordance for an entity page
 */
export { parseDeck, parseBlocks, renderSlide, renderInline } from "./model";
export type { Slide, Block } from "./model";

export { deckFromEntity } from "./fromEntity";
export { deckToPptx } from "./toPptx";
export type { PptxOptions } from "./toPptx";

export { SlidesViewer } from "./SlidesViewer";
export { SlidesPage, deckHref, pptxHref } from "./SlidesPage";
export { SlidesLink } from "./SlidesLink";
