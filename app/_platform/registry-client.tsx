"use client";

/**
 * The product list, for client components.
 *
 * A client component cannot read the registry (that is a database), so the
 * root layout hands the slugs down once per page. Design Mode and the dock use
 * them to tell a product path from a platform one: on `/about` a note is a
 * site wish, on `/gtm/research` a gtm wish.
 */
import { createContext, useContext, type ReactNode } from "react";

const Ctx = createContext<string[]>([]);

export function RegistryProvider({ slugs, children }: { slugs: string[]; children: ReactNode }) {
  return <Ctx.Provider value={slugs}>{children}</Ctx.Provider>;
}

/** Every registered product slug. */
export function useProductSlugs(): string[] {
  return useContext(Ctx);
}
