/** Generic entity page for a product without pages of its own. */
import { notFound } from "next/navigation";
import { getProduct } from "@/app/lib/registry";
import { ProductShell } from "@/app/_platform/ProductShell";
import { EntityPage } from "@/app/_platform/research/EntityPage";

export default async function GenericTopic({ params }: { params: Promise<{ slug: string; topic: string }> }) {
  const { slug, topic } = await params;
  if (!(await getProduct(slug))) notFound();
  return (
    <ProductShell slug={slug} active="research">
      <EntityPage productSlug={slug} slug={topic} />
    </ProductShell>
  );
}
