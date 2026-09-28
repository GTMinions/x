/**
 * Share topics — the snack-size front door onto a product's research corpus.
 *
 * A research entity is the wrong shape to post: depth 7, twelve citations, six
 * benchmark tables. A share topic is the same evidence cut to the shape a feed
 * accepts — a few 3:4 cards, a title, a caption, hashtags — in Chinese, sized
 * for Xiaohongshu (see the `xiaohongshu-post` skill for the format's rules).
 *
 * This began as gtm's private feature (`(products)/gtm/research/share/_sharing.ts`)
 * and moved to the spine per wish #14, the same split the rest of the research
 * site uses: the ENGINE is shared, the CONTENT stays in the product's folder at
 * `app/(products)/<slug>/research/content/sharing/*.json`. A product with no
 * sharing folder renders an honest empty index, not an error.
 *
 * The rule that keeps it honest travels with the engine: **a card names the
 * entity it came from.** `entity` is a real slug in that product's corpus and
 * the topic page links to it, because a social post is a marketing claim
 * wearing a smaller hat, and a marketing claim names its evidence.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** 1080×1440. The 3:4 portrait ratio Xiaohongshu gives the most feed height to. */
export const CARD_W = 1080;
export const CARD_H = 1440;

export type ShareCard = {
  /** What this card is for, in the editor's words. Not rendered on the card. */
  role: string;
  svg: string;
};

export type ShareTopic = {
  slug: string;
  /** The post's title, as it would be typed into Xiaohongshu. */
  title: string;
  /** One line, for the index. */
  hook: string;
  /** The caption body. Ready to paste. */
  caption: string;
  hashtags: string[];
  /** The entity in the owning product's corpus that the claims rest on. */
  entity: string;
  /** Why this was worth a post — the editorial call, in English, for the loop. */
  angle: string;
  published: string;
  cards: ShareCard[];
};

const dirFor = (productSlug: string) =>
  path.join(process.cwd(), "app", "(products)", productSlug, "research", "content", "sharing");

export function loadShareTopics(productSlug: string): ShareTopic[] {
  let files: string[];
  try {
    files = readdirSync(dirFor(productSlug)).filter((f) => f.endsWith(".json"));
  } catch {
    return []; // no sharing folder yet — a valid state, not a failure
  }
  const topics = files.map(
    (f) => JSON.parse(readFileSync(path.join(dirFor(productSlug), f), "utf8")) as ShareTopic,
  );
  // Newest first — a feed is a stack, not an archive.
  return topics.sort((a, b) => (a.published < b.published ? 1 : -1));
}

export function loadShareTopic(productSlug: string, slug: string): ShareTopic | null {
  return loadShareTopics(productSlug).find((t) => t.slug === slug) ?? null;
}
