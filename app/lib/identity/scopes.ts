import "server-only";

// Canonical scope strings + role → scope mapping. Mirrors
// the accounts service's scopes module so tokens edu mints carry the same
// claims accounts would. Role is the storage column; scopes are the
// runtime claim derived from it at mint time.

export const BASE_CONSUMER = ["account:read", "account:write"] as const;
export const ADMIN_ALL = ["admin:*"] as const;
export const OWNER_ONLY = ["owner:*"] as const;

export type AccountRole = "user" | "admin" | "owner";

export function scopesForRole(role: AccountRole | string): string[] {
  switch (role) {
    case "owner":
      return [...BASE_CONSUMER, ...ADMIN_ALL, ...OWNER_ONLY];
    case "admin":
      return [...BASE_CONSUMER, ...ADMIN_ALL];
    default:
      return [...BASE_CONSUMER];
  }
}

export function hasScopeMatch(scopes: string[] | undefined, want: string): boolean {
  if (!scopes?.length) return false;
  if (scopes.includes(want)) return true;
  const colon = want.indexOf(":");
  if (colon < 0) return false;
  const prefix = want.slice(0, colon) + ":*";
  return scopes.includes(prefix);
}

export function isAdmin(scopes: string[] | undefined): boolean {
  return hasScopeMatch(scopes, "admin:read") || hasScopeMatch(scopes, "admin:*");
}

export function isOwner(scopes: string[] | undefined): boolean {
  return hasScopeMatch(scopes, "owner:*");
}
