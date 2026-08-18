import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { get, run } from "./db";
import { SESSION_COOKIE, readSessionToken } from "./session";
import type { AppUser, SessionUser } from "./types";

export const BCRYPT_COST = 12;

/**
 * Verify a username and password against the users table.
 *
 * Returns null for every failure mode — unknown user, inactive account, no
 * password set, wrong password — so the response cannot be used to enumerate
 * accounts. A dummy hash comparison runs when the user does not exist to keep
 * the timing roughly constant.
 */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.7Vv7ZfC/mQZ1zXKlYbHqZ1FSN1YFz9K";

export function verifyCredentials(username: string, password: string): AppUser | null {
  const user = get<AppUser & { password_hash: string }>(
    `SELECT * FROM users WHERE username = ? COLLATE NOCASE`,
    [username.trim()]
  );

  if (!user || !user.active || !user.password_hash) {
    bcrypt.compareSync(password, DUMMY_HASH);
    return null;
  }
  if (!bcrypt.compareSync(password, user.password_hash)) return null;

  run(`UPDATE users SET last_login = ? WHERE user_id = ?`, [
    new Date().toISOString(),
    user.user_id,
  ]);

  const { password_hash: _ignored, ...safe } = user;
  void _ignored;
  return safe as AppUser;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_COST);
}

/** Minimum password policy applied wherever a password is set. */
export function passwordProblem(password: string): string | null {
  if (typeof password !== "string" || password.length < 10) {
    return "Password must be at least 10 characters.";
  }
  if (password.length > 200) return "Password is too long.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}

export function toSessionUser(user: AppUser): SessionUser {
  return {
    userId: user.user_id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    departmentId: user.department_id,
  };
}

/** Current session for server components and route handlers. */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  return readSessionToken(jar.get(SESSION_COOKIE)?.value);
}

/** Session, or throw — for routes that must never run anonymously. */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = "Not signed in") {
    super(message);
  }
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "You do not have permission to do that") {
    super(message);
  }
}
