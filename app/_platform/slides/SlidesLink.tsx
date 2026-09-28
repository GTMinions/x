/**
 * The "Present" affordance for an entity page.
 *
 * Defaults to the spine-owned deck URL (`/slides/<product>/<slug>`), which
 * exists for every product with no per-product route. If a product later adds an
 * in-product alias (`/<product>/research/<slug>/slides`), pass `href` to point
 * at it — the default is chosen so this component can never ship a dead link.
 */
import React from "react";
import Link from "next/link";
import { deckHref } from "./SlidesPage";
import { T, t } from "@/app/_platform/copy";

export function SlidesLink({
  slug,
  productSlug,
  href,
  className = t("site.platform.slides.slideslink.s-1"),
}: {
  slug: string;
  productSlug: string;
  href?: string;
  className?: string;
}) {
  return (
    <Link
      className={className}
      href={href ?? deckHref(productSlug, slug)}
      style={{ fontSize: 12 }}
    >
      <T id="site.platform.slides.slideslink.link-1" />
    </Link>
  );
}
