"use client";

import { useEffect, useRef } from "react";

/** A plain modal drawn as a sheet cutout. Closes on Esc and backdrop click. */
export default function Dialog({
  title,
  onClose,
  children,
  width = 460,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(22,32,42,0.34)" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="titleblock w-full max-h-[calc(100vh-2rem)] overflow-y-auto thin-scroll"
        style={{ maxWidth: width }}
      >
        <div className="tb-row" style={{ gridTemplateColumns: "1fr auto" }}>
          <div className="tb-cell">
            <div className="anno-lg">{title}</div>
          </div>
          <button
            onClick={onClose}
            className="tb-cell anno hover:bg-[rgba(147,163,174,0.14)]"
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
