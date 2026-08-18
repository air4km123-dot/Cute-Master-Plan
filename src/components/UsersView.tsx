"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Dialog from "./Dialog";
import type { AppUser, Department, Role } from "@/lib/types";

/**
 * Account management (§2).
 *
 * Passwords are set here and hashed on the server. Accounts seeded from the
 * source sheet start with no password and cannot sign in until one is set,
 * which is what makes bulk onboarding safe.
 */

const ROLE_HINT: Record<Role, string> = {
  ADMIN: "Everything, including approving connections and reading the audit log",
  OWNER: "Edits only their own projects",
  VIEWER: "Read only",
};

export default function UsersView({
  users,
  departments,
  ownedCounts,
  currentUserId,
}: {
  users: AppUser[];
  departments: Department[];
  ownedCounts: Record<string, number>;
  currentUserId: string;
}) {
  const router = useRouter();
  const [passwordFor, setPasswordFor] = useState<AppUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = users.filter((u) => u.must_set_password && u.active).length;

  async function patch(user: AppUser, body: Record<string, unknown>) {
    setBusyId(user.user_id);
    setError(null);
    const response = await fetch(`/api/users/${user.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    setBusyId(null);
    if (!response.ok) {
      setError(data.error ?? "Could not update the account.");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="h-full overflow-y-auto thin-scroll">
      <div className="max-w-[1180px] mx-auto p-6">
        <header className="mb-5 flex items-start gap-4">
          <div className="flex-1">
            <h1 className="anno-lg text-[17px]">User accounts</h1>
            <p className="note mt-1 max-w-[62ch]">
              Air4 accounts sign in with a username and password. {pending > 0 ? (
                <>
                  <span className="font-semibold">{pending}</span> account
                  {pending === 1 ? "" : "s"} still need a password before anyone can use{" "}
                  {pending === 1 ? "it" : "them"}.
                </>
              ) : (
                "Every active account has a password set."
              )}
            </p>
          </div>
          <button className="btn btn-solid" onClick={() => setCreating(true)}>
            Add account
          </button>
        </header>

        {error && (
          <p role="alert" className="text-[12px] text-stamp border-l-2 border-stamp pl-2.5 mb-3">
            {error}
          </p>
        )}

        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Projects</th>
                <th>Sign-in</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.user_id} style={user.active ? undefined : { opacity: 0.5 }}>
                  <td>
                    <span className="partno">{user.username}</span>
                    {user.user_id === currentUserId && (
                      <span className="anno ml-2">You</span>
                    )}
                  </td>
                  <td className="text-[12px]">{user.display_name}</td>
                  <td>
                    <select
                      className="field w-auto py-1"
                      value={user.role}
                      disabled={busyId === user.user_id}
                      onChange={(e) => patch(user, { role: e.target.value })}
                      aria-label={`Role for ${user.username}`}
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="OWNER">Owner</option>
                      <option value="VIEWER">Viewer</option>
                    </select>
                  </td>
                  <td className="partno">{user.department_id ?? "—"}</td>
                  <td className="data">{ownedCounts[user.user_id] ?? 0}</td>
                  <td>
                    {user.must_set_password ? (
                      <span className="anno" style={{ color: "var(--color-stamp)" }}>
                        No password
                      </span>
                    ) : (
                      <span className="anno">Ready</span>
                    )}
                  </td>
                  <td className="data whitespace-nowrap">
                    {user.last_login ? new Date(user.last_login).toLocaleDateString() : "Never"}
                  </td>
                  <td>
                    <span className="flex gap-1.5 justify-end">
                      <button
                        className="btn btn-quiet"
                        disabled={busyId === user.user_id}
                        onClick={() => setPasswordFor(user)}
                      >
                        Set password
                      </button>
                      <button
                        className="btn btn-quiet"
                        disabled={busyId === user.user_id || user.user_id === currentUserId}
                        onClick={() => patch(user, { active: user.active ? 0 : 1 })}
                      >
                        {user.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="note mt-3 max-w-[62ch]">
          Role meanings — Admin: {ROLE_HINT.ADMIN}. Owner: {ROLE_HINT.OWNER}. Viewer:{" "}
          {ROLE_HINT.VIEWER}.
        </p>
      </div>

      {passwordFor && (
        <PasswordDialog
          user={passwordFor}
          onClose={() => setPasswordFor(null)}
          onSaved={() => {
            setPasswordFor(null);
            router.refresh();
          }}
        />
      )}

      {creating && (
        <CreateDialog
          departments={departments}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function PasswordDialog({
  user,
  onClose,
  onSaved,
}: {
  user: AppUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function save() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/users/${user.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not set the password.");
      return;
    }
    onSaved();
  }

  return (
    <Dialog title={`Set password — ${user.username}`} onClose={onClose}>
      <div className="space-y-3.5">
        <div>
          <label htmlFor="pw-new" className="anno block mb-1">
            New password
          </label>
          <input
            id="pw-new"
            type="password"
            className="field"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="note mt-1">At least 10 characters, with a letter and a number.</p>
        </div>
        <div>
          <label htmlFor="pw-confirm" className="anno block mb-1">
            Confirm password
          </label>
          <input
            id="pw-confirm"
            type="password"
            className="field"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch && <p className="note mt-1">The two passwords do not match.</p>}
        </div>

        <p className="note border-l-2 border-rule-strong pl-2.5">
          The password is hashed on the server. It is never stored in the sheet, the audit log or
          this page.
        </p>

        {error && (
          <p role="alert" className="text-[12px] text-stamp border-l-2 border-stamp pl-2.5">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            className="btn btn-solid flex-1"
            disabled={busy || !password || mismatch || password !== confirm}
            onClick={save}
          >
            {busy ? "Saving…" : "Set password"}
          </button>
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function CreateDialog({
  departments,
  onClose,
  onCreated,
}: {
  departments: Department[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("OWNER");
  const [departmentId, setDepartmentId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        display_name: displayName,
        role,
        department_id: departmentId || null,
        password: password || undefined,
      }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not create the account.");
      return;
    }
    onCreated();
  }

  return (
    <Dialog title="Add account" onClose={onClose}>
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="u-username" className="anno block mb-1">
              Username
            </label>
            <input
              id="u-username"
              className="field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="u-name" className="anno block mb-1">
              Display name
            </label>
            <input
              id="u-name"
              className="field"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="u-role" className="anno block mb-1">
              Role
            </label>
            <select
              id="u-role"
              className="field"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="ADMIN">Admin</option>
              <option value="OWNER">Owner</option>
              <option value="VIEWER">Viewer</option>
            </select>
            <p className="note mt-1">{ROLE_HINT[role]}</p>
          </div>
          <div>
            <label htmlFor="u-dept" className="anno block mb-1">
              Department
            </label>
            <select
              id="u-dept"
              className="field"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">None</option>
              {departments.map((dept) => (
                <option key={dept.dept_code} value={dept.dept_code}>
                  {dept.dept_code} · {dept.dept_name_en}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="u-password" className="anno block mb-1">
            Password
          </label>
          <input
            id="u-password"
            type="password"
            className="field"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="note mt-1">
            Leave blank to create the account without sign-in access. You can set a password later.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-[12px] text-stamp border-l-2 border-stamp pl-2.5">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            className="btn btn-solid flex-1"
            disabled={busy || !username.trim() || !displayName.trim()}
            onClick={create}
          >
            {busy ? "Creating…" : "Create account"}
          </button>
          <button className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}
