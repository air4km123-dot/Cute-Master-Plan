import { NextResponse } from "next/server";
import { verifyCredentials, toSessionUser } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

/**
 * Sign in with an Air4 username and password (Addendum V2 §1).
 * Google sign-in is deliberately not offered.
 */

// Simple in-process throttle. Enough to blunt online guessing on a single
// server; a shared store would be needed once this runs on more than one node.
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function throttled(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clearThrottle(key: string) {
  attempts.delete(key);
}

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a username and password." }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${ip}:${username.toLowerCase()}`;

  if (throttled(key)) {
    return NextResponse.json(
      { error: "Too many attempts. Wait 10 minutes and try again." },
      { status: 429 }
    );
  }

  const user = await verifyCredentials(username, password);

  if (!user) {
    await recordAudit({
      actor: null,
      action: "LOGIN_FAILED",
      entityType: "SESSION",
      entityId: null,
      notes: `Failed sign-in for "${username}"`,
    });
    // One message for every failure, so responses cannot confirm which
    // usernames exist or which accounts have no password set.
    return NextResponse.json({ error: "Username or password is incorrect." }, { status: 401 });
  }

  clearThrottle(key);

  const session = toSessionUser(user);
  const token = await createSessionToken(session);

  await recordAudit({
    actor: session,
    action: "LOGIN",
    entityType: "SESSION",
    entityId: user.user_id,
    notes: `Signed in as ${user.role}`,
  });

  const response = NextResponse.json({ user: session });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
