/**
 * The registry as pages read it. Everything lives in ./core (which scripts and
 * the wish store also use); this module is the `server-only` door so a client
 * component cannot import a database client by accident.
 */
import "server-only";

export {
  listProducts,
  listProductSlugs,
  getProduct,
  listTeams,
  getTeam,
  invalidateRegistry,
  wishBlocks,
  registryMode,
} from "./core";
export type { RegistryMode } from "./core";
export type { Product, Team, ProductStatus, Visibility } from "./core";
