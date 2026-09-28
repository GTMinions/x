"use client";

/**
 * Copy for client components.
 *
 * A client component cannot read the working copy (no fs in the browser), so
 * the server page that renders it hands over the rows it needs through
 * <CopyScope prefix="…"> (see ./index). Inside, `useCopy()` returns the same
 * `T` / `t` pair the server pages use, bound to that slice.
 *
 * A row missing from the slice renders as its id, exactly as on the server,
 * so a scope with the wrong prefix is visible on the page rather than silent.
 */
import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import { renderCopyNodes, renderCopyString, missingCopy, type CopyVars } from "./render";

type Rows = Record<string, string>;

const CopyContext = createContext<Rows>({});

export function CopyProvider({ rows, children }: { rows: Rows; children: ReactNode }) {
  const parent = useContext(CopyContext);
  // Nested scopes accumulate, so a client component inside another's scope
  // still finds its own rows.
  const merged = useMemo(() => ({ ...parent, ...rows }), [parent, rows]);
  return <CopyContext.Provider value={merged}>{children}</CopyContext.Provider>;
}

export function bindCopy(rows: Rows) {
  const t = (id: string, vars?: CopyVars): string => {
    const row = rows[id];
    return typeof row === "string" ? renderCopyString(row, vars) : missingCopy(id);
  };
  const T = ({ id, v, c }: { id: string; v?: CopyVars; c?: ReactNode[] }) => {
    const row = rows[id];
    return (
      <span className="cid" data-cid={id}>
        {typeof row === "string" ? renderCopyNodes(row, v, c) : missingCopy(id)}
      </span>
    );
  };
  return { t, T };
}

/** The `T` / `t` pair for the enclosing <CopyScope>. */
export function useCopy() {
  const rows = useContext(CopyContext);
  return useMemo(() => bindCopy(rows), [rows]);
}
