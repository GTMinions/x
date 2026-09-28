/**
 * One share card, as a PNG — the engine half of a product's
 * `research/share/[topic]/card/[n]/route.ts`.
 *
 * The cards are authored as SVG, and SVG is the wrong thing to hand a person who
 * is about to post. Xiaohongshu takes JPG/PNG/HEIC; so does every phone photo
 * picker. An `.svg` download is a file the target app will not open.
 *
 * It is also unsafe in a way that matters here: an SVG embeds no font, so the text
 * is re-laid-out by whatever CJK face the opening device happens to have. The
 * frame we measured is not the frame that gets posted. Rasterising freezes the
 * type at 1080×1440 and makes the generator's margin guard actually binding.
 *
 * The SVG stays the source of truth in the product's `content/sharing/*.json`;
 * this is the export. Cards are static content, so the render is cached hard.
 */
import sharp from "sharp";
import { loadShareTopic } from "./sharing";

export async function shareCardPng(productSlug: string, topic: string, n: string): Promise<Response> {
  const t = loadShareTopic(productSlug, topic);
  if (!t) return new Response("no such topic", { status: 404 });

  const index = Number(n);
  if (!Number.isInteger(index) || index < 1 || index > t.cards.length) {
    return new Response("no such card", { status: 404 });
  }

  const png = await sharp(Buffer.from(t.cards[index - 1].svg)).png().toBuffer();

  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      // Named so a phone's file list says which card it is.
      "content-disposition": `attachment; filename="${t.slug}-${index}.png"`,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
