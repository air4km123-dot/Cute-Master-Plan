import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthorizedError, getSession } from "./auth";
import { ValidationError } from "./validation";
import { SheetAccessError } from "./googleSheets";
import type { SessionUser } from "./types";

/**
 * One place where every route handler turns an error into a response, so a
 * thrown permission or validation error never leaks a stack trace.
 */

type Handler<T> = (session: SessionUser) => Promise<T> | T;

export async function withSession<T>(handler: Handler<T>): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) throw new UnauthorizedError();
    const result = await handler(session);
    return NextResponse.json(result ?? { ok: true });
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof ForbiddenError ||
      error instanceof UnauthorizedError ||
      // A misconfigured or unreachable Google Sheet is an explainable setup
      // problem, not a crash — the message tells the admin what to fix.
      error instanceof SheetAccessError
    ) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[air4] unhandled route error:", error);
    return NextResponse.json({ error: "Something went wrong saving that." }, { status: 500 });
  }
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }
  throw new ValidationError("Expected a JSON object.");
}
