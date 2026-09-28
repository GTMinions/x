"use client";

import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { useCopy } from "@/app/_platform/copy/client";

/**
 * VoiceInputButton — browser Web Speech API dictation, no backend. Renders null
 * when unsupported (no dead button). On a final transcript, calls onText.
 */
export function VoiceInputButton({ onText, lang = "en-US", size = 34 }: { onText: (t: string) => void; lang?: string; size?: number }) {
  const { t: copyText } = useCopy();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    const SR = (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;
    if (!SR) return;
    setSupported(true);
    const rec = new SR();
    rec.lang = lang; rec.interimResults = false; rec.continuous = false;
    rec.onresult = (e: any) => {
      const t = e.results?.[e.results.length - 1]?.[0]?.transcript?.trim();
      if (t) onTextRef.current(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => { try { rec.abort(); } catch { /* noop */ } };
  }, [lang]);

  if (!supported) return null;
  return (
    <button
      type="button"
      title={listening ? copyText("site.platform.voiceinputbutton.button-1") : copyText("site.platform.voiceinputbutton.button-2")}
      onClick={() => {
        const rec = recRef.current; if (!rec) return;
        if (listening) { rec.stop(); setListening(false); }
        else { try { rec.start(); setListening(true); } catch { /* already started */ } }
      }}
      style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
        border: "1px solid var(--rule)", display: "grid", placeItems: "center",
        background: listening ? "var(--status-bad)" : "var(--bg-sunk)",
        color: listening ? "#fff" : "var(--ink-soft)",
        animation: listening ? "spin 1.4s linear infinite" : "none",
      }}
    >
      <Mic size={16} />
    </button>
  );
}
