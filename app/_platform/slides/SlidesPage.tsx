/**
 * The deck page (server) — the whole capability behind one component.
 *
 * Mirrors EntityPage: the spine does the work, a route is three lines. Because
 * the generator is deterministic there is nothing to cache, no job to queue and
 * no key to hold — the deck is computed from the entity JSON on the way out.
 */
import React from "react";
import Link from "next/link";
import { loadEntities } from "../research/engine";
import { getProduct } from "@/app/lib/products";
import { deckFromEntity } from "./fromEntity";
import { SlidesViewer } from "./SlidesViewer";
import { T } from "@/app/_platform/copy";

/** The canonical deck URL for an entity. Spine-owned, so it exists for every product. */
export function deckHref(productSlug: string, slug: string): string {
  return `/slides/${productSlug}/${slug}`;
}

/** The .pptx download URL for an entity. */
export function pptxHref(productSlug: string, slug: string): string {
  return `/api/slides/pptx?product=${encodeURIComponent(productSlug)}&slug=${encodeURIComponent(slug)}`;
}

export async function SlidesPage({ productSlug, slug }: { productSlug: string; slug: string }) {
  // One pass over the corpus: the entity, and the slug → name map that resolves
  // [[pills]] in its prose to real display names instead of leaking slugs.
  const entities = loadEntities(productSlug);
  const entity = entities.find((e) => e.slug === slug);

  if (!entity) {
    return (
      <div className="card">
        <p className="muted">
          <T id="site.platform.slides.slidespage.p-1" v={{ slug }} c={[<code />]} />
        </p>
        <Link className="btn ghost" href={`/${productSlug}/research`}>
          <T id="site.platform.slides.slidespage.link-1" />
        </Link>
      </div>
    );
  }

  const names = new Map(entities.map((e) => [e.slug, e.name] as const));
  const productName = (await getProduct(productSlug))?.name ?? productSlug;
  const deck = deckFromEntity(entity, productName, names);

  return (
    <SlidesViewer
      deck={deck}
      backHref={`/${productSlug}/research/${slug}`}
      downloadHref={pptxHref(productSlug, slug)}
    />
  );
}
