import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "./types";

/**
 * Session token handling. Kept free of Node-only imports so middleware can
 * verify a session at the edge.
 *
 * The token is a signed JWT in an HttpOnly cookie. It carries identity and
 * role only — never a password, and never business data.
 */

export const SESSION_COOKIE = "air4_session";
export const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Run `npm run seed` to generate .env.local, " +
        "or set a value of at least 32 characters."
    );
  }
  return new TextEncoder().encode(value);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    departmentId: user.departmentId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function readSessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      username: String(payload.username ?? ""),
      displayName: String(payload.displayName ?? ""),
      role: payload.role as SessionUser["role"],
      departmentId: (payload.departmentId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}
