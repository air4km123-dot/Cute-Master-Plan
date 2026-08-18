"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";

/**
 * View / Edit / Presentation modes (§25, §26).
 *
 * Edit mode is opt-in and visually unmistakable so nothing is changed by
 * accident during a meeting. A viewer can never enter it.
 */

export type Mode = "VIEW" | "EDIT" | "PRESENT";

interface ModeValue {
  mode: Mode;
  setMode: (mode: Mode) => void;
  canEdit: boolean;
  session: SessionUser;
}

const ModeCtx = createContext<ModeValue | null>(null);

export function ModeProvider({
  session,
  children,
}: {
  session: SessionUser;
  children: React.ReactNode;
}) {
  const canEdit = session.role === "ADMIN" || session.role === "OWNER";
  const [mode, setModeRaw] = useState<Mode>("VIEW");

  const setMode = useMemo(
    () => (next: Mode) => setModeRaw(next === "EDIT" && !canEdit ? "VIEW" : next),
    [canEdit]
  );

  // Presentation mode drives type scale and hides chrome via a body class, so
  // it applies to portals and the diagram canvas alike.
  useEffect(() => {
    document.body.classList.toggle("presenting", mode === "PRESENT");
    return () => document.body.classList.remove("presenting");
  }, [mode]);

  // Esc leaves presentation mode — expected behaviour for anything fullscreen.
  useEffect(() => {
    if (mode !== "PRESENT") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMode("VIEW");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, setMode]);

  const value = useMemo(
    () => ({ mode, setMode, canEdit, session }),
    [mode, setMode, canEdit, session]
  );

  return <ModeCtx.Provider value={value}>{children}</ModeCtx.Provider>;
}

export function useMode(): ModeValue {
  const ctx = useContext(ModeCtx);
  if (!ctx) throw new Error("useMode must be used inside ModeProvider");
  return ctx;
}
