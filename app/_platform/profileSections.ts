/** Shared builders for the profile dropdown's grouped links. */
export type LinkItem = { href: string; label: string; hint?: string; external?: boolean };
export type Section = { label?: string; items: LinkItem[] };

/** The Settings group — shown to everyone (management is scope-gated per page). */
export function settingsSection(): Section {
  return {
    label: "Settings",
    items: [
      { href: "/settings/site", label: "Site", hint: "Name, domain, admins" },
      { href: "/settings/products", label: "Products", hint: "Manage & export" },
      { href: "/settings/teams", label: "Teams" },
      { href: "/settings/workspaces", label: "Workspaces" },
    ],
  };
}
