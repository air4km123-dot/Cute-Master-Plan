"use client";

import { useCallback, useEffect, useState } from "react";
import type { SyncStatus } from "@/lib/googleSheetsSync";

/**
 * One-click Google Sheet sync for the Master Plan toolbar.
 *
 * Fetches the sheet, compares, applies the safe subset and refreshes the
 * diagram in place — no page reload, no redirect, no modal. The apply endpoint
 * re-derives the plan from a fresh read, so a single call covers fetch → check →
 * apply and there is no stale preview to trust.
 *
 * Anything a safe sync refuses to touch — a department change, a duplicate row,
 * an unmapped status — is reported here as a count and reviewed in full at
 * /sync. Deliberately terse: this button is for the ordinary case where the
 * sheet simply moved ahead.
 *
 * The button is admin-only because applying writes to projects. Everyone still
 * sees when the data was last synced.
 */

type Phase = "idle" | "syncing" | "done" | "error";

export default function SyncButton({
  canSync,
  onSynced,
}: {
  canSync: boolean;
  /** Reload the Master Plan payload so the canvas shows the new values. */
  onSynced: () => Promise<void> | void;
}) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/google-sheet/status");
      if (response.ok) setStatus(await response.json());
    } catch {
      /* the indicator is optional; a failure here must not break the canvas */
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function sync() {
    setPhase("syncing");
    setMessage(null);
    try {
      const response = await fetch("/api/sync/google-sheet/apply", { method: "POST" });
      const body = await response.json();

      if (!response.ok) {
        setPhase("error");
        setMessage(body.error ?? "Sync failed.");
        return;
      }

      const { appliedProjects, appliedFields, plan } = body;
      const warnings = plan?.summary?.warnings ?? 0;
      const conflicts = plan?.summary?.conflicts ?? 0;

      let text: string;
      if (appliedFields === 0) {
        text = "Already up to date";
      } else {
        text = `${appliedProjects} project${appliedProjects === 1 ? "" : "s"} updated`;
      }
      if (conflicts > 0) {
        text += ` · ${conflicts} conflict${conflicts === 1 ? "" : "s"} held for review`;
      } else if (warnings > 0) {
        text += ` · ${warnings} warning${warnings === 1 ? "" : "s"}`;
      }

      setPhase("done");
      setMessage(text);
      if (body.status) setStatus(body.status);
      await onSynced();
    } catch {
      setPhase("error");
      setMessage("Could not reach the server.");
    }
  }

  const lastSync = status?.lastApply?.started_at ?? status?.lastCheck?.started_at ?? null;
  const attention = (status?.openCritical ?? 0) > 0;

  return (
    <>
      {/* Last sync indicator — visible to every role. */}
      <span className="anno" title={lastSync ? new Date(lastSync).toISOString() : undefined}>
        {lastSync ? (
          <>
            Last sync · <LocalTime iso={lastSync} />
          </>
        ) : (
          "Never synced"
        )}
      </span>

      {message && (
        <span
          className="anno"
          style={{
            color:
              phase === "error" || attention ? "var(--color-stamp)" : "var(--color-ink-soft)",
          }}
        >
          {message}
        </span>
      )}

      {canSync && (
        <button
          className="btn btn-quiet"
          onClick={sync}
          disabled={phase === "syncing" || !status?.configured}
          title={
            status?.configured
              ? "Read the Google Sheet and apply safe source updates"
              : (status?.problem ?? "Google Sheets is not configured")
          }
        >
          {phase === "syncing" ? "Syncing…" : "↻ Sync Sheet"}
        </button>
      )}
    </>
  );
}

/**
 * Client-only timestamp. `toLocaleString` resolves differently on the server
 * than in the browser, so rendering it during SSR causes a hydration mismatch.
 */
function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(iso);
  useEffect(() => setText(new Date(iso).toLocaleString()), [iso]);
  return <span suppressHydrationWarning>{text}</span>;
}
