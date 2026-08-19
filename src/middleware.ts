import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session";

/**
 * Everything requires a signed-in Air4 account except the login screen and the
 * login endpoint itself. Business data is never served anonymously.
 */

/**
 * Exempt from the session gate.
 *
 * /api/sync/google-sheet/auto is called by the daily scheduler, which has no
 * cookie to present. It is not unprotected: the route itself requires a bearer
 * token matching SYNC_CRON_SECRET, compared in constant time, and refuses to run
 * at all if that secret is unset. Without this exemption the middleware would
 * 401 the scheduler before its own check ever ran.
 */
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/sync/google-sheet/auto",
  // Deployment diagnostics. Bearer-guarded by the same secret, and it has to be
  // reachable without a session precisely when sign-in is the thing that is broken.
  "/api/health",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const session = await readSessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (session && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (isPublic || session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
