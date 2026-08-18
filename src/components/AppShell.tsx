"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMode, type Mode } from "./ModeContext";

/**
 * Top navigation.
 *
 * `/sync` and `/users` are deliberately absent. Both routes still exist and
 * still enforce their own permissions — /sync is where an admin reviews
 * conflicts a safe sync refused to apply, and /users is how a password gets set
 * — but neither earns a permanent tab:
 *
 *   · Sheet sync is now a one-click action in the Master Plan header plus an
 *     automatic run at 08:30 Asia/Bangkok, so the console is for exceptions.
 *   · Accounts are managed rarely and by one person.
 *
 * Reach them by URL: /sync and /users.
 */
const NAV = [
  { href: "/", label: "Master Plan" },
  { href: "/governance", label: "Governance" },
  { href: "/audit", label: "Audit Log", adminOnly: true },
];

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  OWNER: "Project Owner",
  VIEWER: "Viewer",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { mode, setMode, canEdit, session } = useMode();
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const isPresenting = mode === "PRESENT";

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Edit mode is stamped across the top of the sheet — impossible to miss. */}
      {mode === "EDIT" && <div className="editing-rail h-1.5 shrink-0" aria-hidden />}

      <header
        className={`shrink-0 bg-sheet-raised border-b-2 border-ink flex items-stretch ${
          isPresenting ? "h-11" : "h-13"
        }`}
      >
        <div className="px-4 flex flex-col justify-center border-r border-rule">
          <span className="anno-lg">Air4</span>
          <span className="anno mt-px">Master Plan · Rev V2</span>
        </div>

        {!isPresenting && (
          <nav className="flex items-stretch" aria-label="Sections">
            {NAV.filter((item) => !item.adminOnly || session.role === "ADMIN").map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`anno px-4 flex items-center border-r border-rule transition-colors ${
                    active
                      ? "bg-ink text-sheet-raised"
                      : "hover:bg-[rgba(147,163,174,0.16)]"
                  }`}
                  style={active ? { color: "var(--color-sheet-raised)" } : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="flex-1" />

        {isPresenting ? (
          <button
            onClick={() => setMode("VIEW")}
            className="anno px-4 border-l border-rule hover:bg-[rgba(147,163,174,0.16)]"
          >
            Exit presentation · Esc
          </button>
        ) : (
          <>
            <div className="flex items-stretch border-l border-rule" role="group" aria-label="Mode">
              <ModeButton current={mode} value="VIEW" onSelect={setMode} label="View" />
              {canEdit && (
                <ModeButton current={mode} value="EDIT" onSelect={setMode} label="Edit" stamp />
              )}
              <ModeButton current={mode} value="PRESENT" onSelect={setMode} label="Present" />
            </div>

            <div className="px-4 flex flex-col justify-center border-l border-rule min-w-[150px]">
              <span className="anno-lg text-[11px] truncate">{session.displayName}</span>
              <span className="anno mt-px">{ROLE_LABEL[session.role] ?? session.role}</span>
            </div>

            <button
              onClick={signOut}
              className="anno px-4 border-l border-rule hover:bg-[rgba(147,163,174,0.16)]"
            >
              Sign out
            </button>
          </>
        )}
      </header>

      <main className="flex-1 min-h-0">{children}</main>
    </div>
  );
}

function ModeButton({
  current,
  value,
  label,
  onSelect,
  stamp,
}: {
  current: Mode;
  value: Mode;
  label: string;
  onSelect: (mode: Mode) => void;
  stamp?: boolean;
}) {
  const active = current === value;
  return (
    <button
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className="anno px-3.5 border-r border-rule last:border-r-0 transition-colors"
      style={
        active
          ? {
              background: stamp ? "var(--color-stamp)" : "var(--color-ink)",
              color: "#fff",
            }
          : undefined
      }
    >
      {label}
    </button>
  );
}
