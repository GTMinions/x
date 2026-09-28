/**
 * Layout for every product route.
 *
 * Its only job is the export below. There is no chrome here — `ProductShell`
 * already provides that, per product, because each one carries its own accent
 * and nav.
 *
 * WHY force-dynamic
 * A product's content lives in that product's database, not in git, and is
 * written to disk by `product:db pull` before a build. A checkout without
 * credentials therefore has the module signatures but none of the data. That is
 * fine for rendering on demand — the page can report what is missing — but it is
 * fatal during prerendering: Next.js would call into the data layer at build
 * time, get nothing, and fail the export for the whole application rather than
 * for the one page that had no data.
 *
 * Rendering these on request removes build time as a moment that needs the data.
 * The cost is small and mostly theoretical here: every product route already
 * sits behind the sign-in gate in `proxy.ts`, so it was never being served from
 * a static cache to an anonymous visitor anyway.
 */
export const dynamic = "force-dynamic";

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
