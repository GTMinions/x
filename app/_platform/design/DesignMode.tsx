"use client";

/**
 * Design Mode — the overlay half. Two tools: **Select** (hover highlights the element
 * under the cursor; click opens a note anchored to it) and **Draw box** (drag a marquee
 * over any region). Notes become wishes scoped to the product you are on.
 *
 * What used to be here and is not any more: the toolbar bottom-left and the notes panel
 * bottom-right. Both are segments of `SiteDock` now, so turning the mode on no longer
 * adds two objects to a corner that already had two. What is left is what genuinely must
 * be drawn over the page — the ring, the marquee, and the note being typed.
 *
 * Self-contained Ivy palette, still deliberately not the host product's accent, so it
 * reads as a meta-layer over whatever it annotates.
 */
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDesignMode, type Rect } from "./DesignModeContext";
import { useProductSlugs } from "@/app/_platform/registry-client";
import { useCopy } from "@/app/_platform/copy/client";

/** The registry is the only authority on what a product slug is. */

const DM = {
  primary: "#356a4d",
  ring: "rgba(53,106,77,0.9)",
  tint: "rgba(53,106,77,0.08)",
  ink: "#262019",
  inkSoft: "#4b4236",
  surface: "#fffdf8",
  line: "#e4dccb",
  shadow: "0 12px 36px rgba(38,32,25,0.16)",
};

function labelFor(el: Element): string {
  const t = el.getAttribute("data-tour") || el.getAttribute("aria-label");
  if (t) return t;
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
  return text ? `${tag} · "${text}"` : tag;
}

/**
 * The scope is the product you are standing on, or `site`.
 *
 * Taking the first path segment on its own is wrong the moment Design Mode is available
 * outside a product: on `/about` it would file a wish scoped to "about", a scope no
 * product owns and no wishlist reads, and the note would be accepted and then lost.
 */
export function designScope(pathname: string, productSlugs: readonly string[]): string {
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  return productSlugs.includes(first) ? first : "site";
}

export function DesignMode() {
  const { T, t: copyText } = useCopy();
  const productSlugs = useProductSlugs();
  const { on, tool, addNote } = useDesignMode();
  const pathname = usePathname();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; rect: Rect } | null>(null);
  const [draft, setDraft] = useState<{ rect: Rect; target: string } | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!on) { setHover(null); setDraft(null); setDrag(null); setNote(""); }
  }, [on]);

  // Switching tool abandons whatever was half-drawn with the old one.
  useEffect(() => { setDraft(null); setDrag(null); setHover(null); }, [tool]);

  const elementAt = useCallback((x: number, y: number): Element | null => {
    const ov = overlayRef.current; if (!ov) return null;
    const prev = ov.style.pointerEvents; ov.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y); ov.style.pointerEvents = prev;
    return el && el !== ov ? el : null;
  }, []);

  const rectOf = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  if (!on) return null;

  return (
    <>
      <div
        ref={overlayRef}
        onMouseMove={(e) => {
          if (draft) return;
          if (tool === "select") {
            const el = elementAt(e.clientX, e.clientY);
            setHover(el && el.getBoundingClientRect().width > 4 ? rectOf(el) : null);
          } else if (drag) {
            setDrag({ ...drag, rect: {
              x: Math.min(drag.x0, e.clientX), y: Math.min(drag.y0, e.clientY),
              w: Math.abs(e.clientX - drag.x0), h: Math.abs(e.clientY - drag.y0),
            } });
          }
        }}
        onMouseDown={(e) => { if (tool === "draw" && !draft) setDrag({ x0: e.clientX, y0: e.clientY, rect: { x: e.clientX, y: e.clientY, w: 0, h: 0 } }); }}
        onMouseUp={() => {
          if (tool === "draw" && drag) {
            if (drag.rect.w > 8 && drag.rect.h > 8) { setDraft({ rect: drag.rect, target: "Marked area" }); setNote(""); }
            setDrag(null);
          }
        }}
        onClick={(e) => {
          if (tool === "select" && !draft) {
            const el = elementAt(e.clientX, e.clientY);
            if (el) { setDraft({ rect: rectOf(el), target: labelFor(el) }); setNote(""); }
          }
        }}
        style={{ position: "fixed", inset: 0, zIndex: 9000, cursor: "crosshair", background: DM.tint, userSelect: "none" }}
      >
        {tool === "select" && hover && !draft && (
          <div style={{ position: "fixed", left: hover.x, top: hover.y, width: hover.w, height: hover.h, border: `2px solid ${DM.ring}`, borderRadius: 4, pointerEvents: "none" }} />
        )}
        {drag && (
          <div style={{ position: "fixed", left: drag.rect.x, top: drag.rect.y, width: drag.rect.w, height: drag.rect.h, border: `2px dashed ${DM.primary}`, background: DM.tint, pointerEvents: "none" }} />
        )}
        {draft && (
          <div style={{ position: "fixed", left: draft.rect.x, top: draft.rect.y, width: draft.rect.w, height: draft.rect.h, border: `2px solid ${DM.primary}`, background: DM.tint, borderRadius: 4, pointerEvents: "none" }} />
        )}
      </div>

      {/* The one light card on screen, because it is the only thing being written into.
          Kept clear of the dock, which occupies the bottom-right 340×220. */}
      {draft && (
        <div
          style={{
            position: "fixed", zIndex: 9100,
            left: Math.min(draft.rect.x, window.innerWidth - 320),
            top: Math.min(draft.rect.y + draft.rect.h + 8, window.innerHeight - 320),
            width: 300, background: DM.surface, color: DM.ink,
            border: `1px solid ${DM.line}`, borderRadius: 12, boxShadow: DM.shadow, padding: 14,
          }}
        >
          <div style={{ fontSize: 11, color: DM.inkSoft, fontFamily: "var(--font-mono)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {draft.target}
          </div>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={copyText("site.platform.design.designmode.placeholder-2")}
            style={{ width: "100%", minHeight: 64, resize: "vertical", border: `1px solid ${DM.line}`, borderRadius: 8, padding: 8, fontSize: 13, color: DM.ink, fontFamily: "var(--font-sans)" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setDraft(null)} style={btn("ghost")}><T id="site.platform.design.designmode.button-8" /></button>
            <button
              disabled={!note.trim()}
              onClick={() => { addNote({ target: draft.target, note: note.trim(), rect: draft.rect }); setDraft(null); setNote(""); }}
              style={btn("solid")}
            >
              <T id="site.platform.design.designmode.button-9" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function btn(kind: "solid" | "ghost"): React.CSSProperties {
  return kind === "solid"
    ? { display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "none", background: DM.primary, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }
    : { padding: "6px 10px", borderRadius: 8, border: `1px solid ${DM.line}`, background: "transparent", color: DM.inkSoft, fontSize: 12.5, cursor: "pointer" };
}
