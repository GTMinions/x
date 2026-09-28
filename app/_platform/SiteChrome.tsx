"use client";

/**
 * SiteChrome — the client half of the platform shell.
 *
 * Design Mode lived only in `ProductChrome`, so the annotation overlay worked on every
 * product page and existed on none of the platform's own pages. The landing directory
 * and the About roster are surfaces a reader can dislike as easily as any product
 * screen, and until now there was no way to say so from them.
 *
 * `SiteNav` is a server component (it reads the session for the profile menu), and
 * Design Mode needs client state. So the provider lives here and the server nav renders
 * inside as children.
 *
 * What left: `ViberBar slug="site"` (a light tinted strip that read as product UI on the
 * platform's own pages — its sentence was decoration and its numbers are in the dock)
 * and `DesignToggle` (a floating pill that overlapped `AdminBar` in the same corner).
 * Both are `SiteDock` now.
 */
import React from "react";
import { DesignModeProvider } from "./design/DesignModeContext";
import { DesignMode } from "./design/DesignMode";

/**
 * The dock arrives as a PROP, not an import.
 *
 * `SiteDockMount` reads the session and the payment mode, so it is a server
 * component; this file is `"use client"` because Design Mode is client state.
 * Importing one from the other pulls `next/headers` into the client bundle and
 * the build refuses it — correctly. Every caller is already a server component,
 * so it renders the dock there and hands the element down.
 */
export function SiteChrome({
  canDesign,
  dock,
  children,
}: {
  canDesign?: boolean;
  dock?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DesignModeProvider>
      {children}
      {/* The dock carries the wish CTA, so the platform itself can be wished about from
          any of its own pages. */}
      {dock}
      {/* Owner tool. See ProductChrome for why. */}
      {canDesign && <DesignMode />}
    </DesignModeProvider>
  );
}
