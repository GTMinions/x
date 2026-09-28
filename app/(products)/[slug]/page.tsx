/**
 * Generic product landing. A product registered in the site database whose
 * pages are not in code gets this: its name, its research site, and the
 * shared surfaces. A product with a folder of its own (inference-economics)
 * never reaches here — Next resolves the static folder first.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct } from "@/app/lib/registry";
import { ProductShell } from "@/app/_platform/ProductShell";
import { loadEntities } from "@/app/_platform/research/engine";
import { T } from "@/app/_platform/copy";

export default async function GenericProduct({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  const entities = loadEntities(slug);

  return (
    <ProductShell slug={slug} active="">
      <div className="eyebrow">{product.teamSlug}</div>
      <h1 style={{ marginTop: 8 }}>{product.name}</h1>
      <p className="muted" style={{ maxWidth: 560, marginTop: 8, fontSize: 15 }}>{product.tagline}</p>

      <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
        <Link className="btn" href={`/${slug}/research`}><T id="site.products.slug.link-1" /></Link>
        <Link className="btn ghost" href={`/${slug}/launch`}><T id="site.products.slug.link-2" /></Link>
        <Link className="btn ghost" href={`/${slug}/wishes`}><T id="site.products.slug.link-3" /></Link>
      </div>

      <div className="card" style={{ marginTop: 32, maxWidth: 640 }}>
        {entities.length ? (
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            <T id="site.products.slug.p-1" v={{ entities: entities.length }} />
          </p>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            <T id="site.products.slug.p-2" v={{ slug }} c={[<code />]} />
          </p>
        )}
      </div>
    </ProductShell>
  );
}
