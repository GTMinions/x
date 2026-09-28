/** Generic changelog — an honest empty state for a product without pages of its own. */
import { notFound } from "next/navigation";
import { getProduct } from "@/app/lib/registry";
import { ProductShell } from "@/app/_platform/ProductShell";
import { T } from "@/app/_platform/copy";

export default async function GenericChangelog({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  return (
    <ProductShell slug={slug} active="changelog">
      <h1><T id="site.products.slug.changelog.h1-1" /></h1>
      <div className="card" style={{ marginTop: 24, maxWidth: 640 }}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}><T id="site.products.slug.changelog.p-1" /></p>
      </div>
    </ProductShell>
  );
}
