/**
 * GET /api/slides/pptx?product=<slug>&slug=<entity> → the entity's deck as .pptx.
 *
 * Deterministic and self-contained: read the entity off disk, generate the deck,
 * zip the OOXML in-process, stream it back as a download. No model call, no job
 * queue, no external service — the same request always yields the same deck.
 *
 * Auth is the platform gate in proxy.ts and nothing more; a signed-out caller is
 * 401'd there and never reaches this handler.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getProduct } from "@/app/lib/products";
import { loadEntity } from "@/app/_platform/research/engine";
import { deckFromEntity } from "@/app/_platform/slides/fromEntity";
import { deckToPptx } from "@/app/_platform/slides/toPptx";
import { loadEntities } from "@/app/_platform/research/engine";

// fs + the OOXML zip writer: Node runtime, evaluated per request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export async function GET(req: NextRequest) {
  const productSlug = req.nextUrl.searchParams.get("product")?.trim() ?? "";
  const slug = req.nextUrl.searchParams.get("slug")?.trim() ?? "";

  if (!productSlug || !slug) {
    return NextResponse.json({ error: "product and slug are required" }, { status: 400 });
  }

  // Only a registered product, and only a slug that resolves to a real entity —
  // both go through the registry and the engine, so no caller-supplied string
  // ever reaches the filesystem.
  const product = await getProduct(productSlug);
  if (!product) {
    return NextResponse.json({ error: `unknown product: ${productSlug}` }, { status: 404 });
  }

  const entity = loadEntity(productSlug, slug);
  if (!entity) {
    return NextResponse.json({ error: `unknown entity: ${productSlug}/${slug}` }, { status: 404 });
  }

  const names = new Map(loadEntities(productSlug).map((e) => [e.slug, e.name] as const));
  const deck = deckFromEntity(entity, product.name, names);

  const bytes = await deckToPptx(deck, {
    accent: product.accent,
    product: product.name,
    title: entity.name,
  });

  const filename = `${productSlug}-${slug}.pptx`;
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": PPTX_MIME,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      // The deck is a pure function of repo content; it changes only on deploy.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
