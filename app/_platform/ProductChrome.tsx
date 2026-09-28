"use client";

import { DesignModeProvider } from "./design/DesignModeContext";
import { DesignMode } from "./design/DesignMode";
import { ProductTopNav, type Tab } from "./ProductTopNav";
import { ResearchNav } from "./research/ResearchNav";
import { SiteDock } from "./SiteDock";
import { ViberBar } from "./ViberBar";

/**
 * ProductChrome — client composition of the product shell: the black top nav, the viber
 * bar, the Design Mode overlay (all under one DesignModeProvider), and the routed page
 * content. Mounted by the server ProductShell so every product gets identical chrome.
 *
 * Design Mode is an OWNER tool and is gated on `canDesign` (the admin scope, decided
 * server-side in ProductShell). Ungated, it handed every signed-in visitor — and on the
 * landing page, every signed-out one — a click-to-write path into the wish store.
 *
 * The wishlist form at /wishes stays open to everyone, so nobody loses the ability to ask
 * for something. They lose the ability to draw on the walls.
 *
 * `SiteDock variant="design"` renders nothing until Design Mode is on: the overlay owns
 * only the ring and the note being typed now, and the tools and note list are dock
 * segments, so a product needs the dock to reach them. At rest the product keeps its own
 * chrome — the nav's inline Design button and the ViberBar — and no dock appears.
 */
export function ProductChrome({
  slug, name, accent, tabs, nickname, email, signedIn, canDesign, children, full = false,
}: {
  slug: string; name: string; accent: string; tabs: Tab[]; nickname?: string; email?: string; signedIn?: boolean; canDesign?: boolean; children: React.ReactNode;
  /** Full-bleed: no reading column and no padding — for a page that is one big surface, like a game. The header stays. */
  full?: boolean;
}) {
  return (
    <DesignModeProvider>
      <ProductTopNav slug={slug} name={name} accent={accent} tabs={tabs} nickname={nickname} email={email} signedIn={signedIn} canDesign={canDesign} />
      {/* Renders itself only on the research site; it decides that from the path. */}
      <ResearchNav slug={slug} />
      <ViberBar slug={slug} />
      {full ? <main style={{ padding: 0 }}>{children}</main> : <main className="wrap" style={{ padding: "32px 24px 96px" }}>{children}</main>}
      {canDesign && <DesignMode />}
      {canDesign && <SiteDock variant="design" canDesign />}
    </DesignModeProvider>
  );
}
