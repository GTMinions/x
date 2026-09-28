/**
 * /slides/<product>/<entity> — the deck for any research entity, any product.
 *
 * Spine-owned on purpose. Because the generator is deterministic and the engine
 * is product-agnostic, one route gives EVERY product's research site a deck with
 * zero per-product code — a product that ships an entity today gets a
 * presentable deck for it on the next build without touching a route file.
 *
 * A product that wants the prettier in-product URL
 * (`/<slug>/research/<topic>/slides`) can add its own three-line route that
 * renders <SlidesPage/>; this one keeps working either way.
 */
import { notFound } from "next/navigation";
import { ProductShell } from "@/app/_platform/ProductShell";
import { SlidesPage } from "@/app/_platform/slides/SlidesPage";
import { getProduct } from "@/app/lib/products";

export default async function Deck({
  params,
}: {
  params: Promise<{ product: string; topic: string }>;
}) {
  const { product, topic } = await params;
  if (!(await getProduct(product))) notFound();

  return (
    <ProductShell slug={product} active="research">
      <SlidesPage productSlug={product} slug={topic} />
    </ProductShell>
  );
}

export async function generateStaticParams() {
  // Left empty: decks render on demand. A large research corpus is thousands of
  // entities across products, and pre-rendering every deck at build time would
  // cost far more than generating one on request ever does.
  return [];
}

export const dynamicParams = true;
