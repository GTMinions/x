/** Shared helper: find every product that ships research content. */
import fs from "node:fs";
import path from "node:path";

export const PRODUCTS_DIR = path.join(process.cwd(), "app", "(products)");

export function productsWithResearch(): string[] {
  let slugs: string[] = [];
  try {
    slugs = fs
      .readdirSync(PRODUCTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
      .map((d) => d.name)
      .filter((slug) => fs.existsSync(path.join(PRODUCTS_DIR, slug, "research", "content", "entities")));
  } catch {
    /* no products dir */
  }
  return slugs;
}
