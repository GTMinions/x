"use client";

/**
 * The game's frame, sized to everything below the product header. The header
 * height is not known ahead of time (the site nav, the product nav, the
 * Viber bar), so the frame measures where it starts and takes the rest of
 * the window, on load and on every resize.
 */
import { useEffect, useRef } from "react";

export function GameFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.height = `${Math.max(480, window.innerHeight - top)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return <iframe ref={ref} src={src} title={title} allow="clipboard-write" style={{ display: "block", width: "100%", height: "calc(100vh - 140px)", border: 0, background: "#EDF0F3" }} />;
}
