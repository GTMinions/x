"use client";

/**
 * ShareCard — the inline card, made draggable to the desktop.
 *
 * The card on the page is inline SVG, and a browser will not let you drag inline
 * SVG to the desktop the way it lets you drag an <img>. Wish #21 asked for exactly
 * that drag. The fix is the Chromium `DownloadURL` drag type: on dragstart we hand
 * the browser the card's own PNG export route (the same file the `↓ N.png` link
 * serves), so releasing the drag on the desktop saves the PNG. Firefox and Safari
 * do not implement `DownloadURL`; there the drag is a no-op and the click link is
 * the path, so the link stays.
 *
 * The card SVG is set `pointer-events: none` (in globals.css) so the drag always
 * originates from this container, not from a text-selection inside the SVG.
 */
import type { CSSProperties } from "react";
import { useCopy } from "@/app/_platform/copy/client";

export function ShareCard({
  svg,
  href,
  filename,
  width,
  height,
}: {
  /** Card SVG, already width/height-stripped for the inline render. */
  svg: string;
  /** Same-origin PNG export route for this card. */
  href: string;
  /** Filename the drag download lands as. */
  filename: string;
  width: number;
  height: number;
}) {
  const { t } = useCopy();
  const style: CSSProperties = {
    borderRadius: "var(--radius-sm)",
    overflow: "hidden",
    border: "1px solid var(--rule)",
    lineHeight: 0,
    aspectRatio: `${width} / ${height}`,
    cursor: "grab",
  };
  return (
    <div
      className="share-card-drag"
      draggable
      onDragStart={(e) => {
        const url = new URL(href, window.location.origin).href;
        // Chromium reads "mime:filename:absolute-url" and downloads on drop-to-desktop.
        e.dataTransfer.setData("DownloadURL", t("site.platform.research.share.sharecard.s-1", { filename, url }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      title={t("site.platform.research.share.sharecard.title-1")}
      style={style}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
