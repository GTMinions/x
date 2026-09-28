"use client";

/**
 * Design Mode state.
 *
 * The overlay used to own its tool, its note list and its submit call, and it drew
 * its own toolbar and its own panel to reach them. That is why the page carried three
 * floating objects at once: the toggle that turned the mode on, the toolbar bottom-left,
 * and the panel bottom-right, none of them aware of the others.
 *
 * The state lives here now, so `SiteDock` can render the controls as segments of the one
 * dock and the overlay is left with the only two things that must be drawn on top of the
 * page: the hover ring and the note being typed.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Rect = { x: number; y: number; w: number; h: number };
export type Note = { id: string; target: string; note: string; rect: Rect };
export type Tool = "select" | "draw";

type Ctx = {
  on: boolean;
  toggle: () => void;
  setOn: (v: boolean) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  notes: Note[];
  addNote: (n: Omit<Note, "id">) => void;
  /** null while idle, a count once a batch has landed. */
  sent: number | null;
  sending: boolean;
  submit: (scope: string, path: string) => Promise<void>;
};

const DesignModeCtx = createContext<Ctx>({
  on: false, toggle: () => {}, setOn: () => {},
  tool: "select", setTool: () => {},
  notes: [], addNote: () => {},
  sent: null, sending: false, submit: async () => {},
});

function structuredBody(target: string, note: string, rect: Rect, path: string): string {
  return [
    `Original feedback: ${note}`,
    `Source: Design Mode`,
    `Selected: ${target}`,
    `Marked region: ${Math.round(rect.w)}×${Math.round(rect.h)} px at (${Math.round(rect.x)}, ${Math.round(rect.y)})`,
    `Page: ${path}`,
    `Category: UX/UI`,
  ].join("\n");
}

export function DesignModeProvider({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [notes, setNotes] = useState<Note[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<number | null>(null);

  const addNote = useCallback((n: Omit<Note, "id">) => {
    setNotes((xs) => [...xs, { ...n, id: `${xs.length + 1}-${n.note.length}` }]);
    setSent(null);
  }, []);

  const submit = useCallback(async (scope: string, path: string) => {
    setSending(true);
    let ok = 0;
    for (const it of notes) {
      try {
        const r = await fetch("/api/wishes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope,
            title: it.note.slice(0, 80),
            body: structuredBody(it.target, it.note, it.rect, path),
            source: "design-mode",
            role: "UX",
          }),
        });
        if (r.ok) ok++;
      } catch { /* a failed note stays in the list */ }
    }
    setSent(ok);
    setNotes([]);
    setSending(false);
  }, [notes]);

  const value = useMemo<Ctx>(() => ({
    on,
    toggle: () => setOn((v) => !v),
    setOn: (v: boolean) => { setOn(v); if (!v) setTool("select"); },
    tool, setTool,
    notes, addNote,
    sent, sending, submit,
  }), [on, tool, notes, addNote, sent, sending, submit]);

  return <DesignModeCtx.Provider value={value}>{children}</DesignModeCtx.Provider>;
}

export function useDesignMode() {
  return useContext(DesignModeCtx);
}
