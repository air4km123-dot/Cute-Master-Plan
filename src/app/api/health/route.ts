import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { client } from "@/lib/db";

/**
 * GET /api/health — deployment diagnostics.
 *
 * A serverless host gives you a bare 500 and keeps the reason in a log you may
 * not be able to reach. This answers the questions that actually matter when a
 * fresh deploy cannot talk to its database: is each variable present, does it
 * look well-formed, and what exactly does the driver say when it tries.
 *
 * Guarded by the same bearer token as the scheduled sync, because even the
 * shape of a configuration is not something to hand out publicly.
 *
 * Secrets are never echoed. Only presence, length and a coarse shape check —
 * enough to catch the common deployment mistakes (a value pasted short, a
 * trailing newline, quotes copied along with the value) without disclosing the
 * value itself.
 */

export const dynamic = "force-dynamic";

function describe(value: string | undefined) {
  if (value === undefined) return { set: false as const };
  return {
    set: true as const,
    length: value.length,
    // These catch the mistakes that produce a 500 with variables "correctly set".
    hasWhitespace: /\s/.test(value),
    hasQuotes: /^["']|["']$/.test(value),
    trimmedDiffers: value !== value.trim(),
  };
}

export async function GET(request: Request) {
  const expected = process.env.SYNC_CRON_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ error: "SYNC_CRON_SECRET is not set." }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.TURSO_DATABASE_URL;
  const env = {
    TURSO_DATABASE_URL: {
      ...describe(url),
      // The scheme decides which transport the driver uses, so it is worth
      // reporting on its own — "libsql://" pasted as "https://" fails oddly.
      scheme: url ? (url.match(/^[a-z]+:\/\//)?.[0] ?? "none") : null,
    },
    TURSO_AUTH_TOKEN: describe(process.env.TURSO_AUTH_TOKEN),
    AUTH_SECRET: describe(process.env.AUTH_SECRET),
    SYNC_CRON_SECRET: describe(process.env.SYNC_CRON_SECRET),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: describe(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    GOOGLE_PRIVATE_KEY: describe(process.env.GOOGLE_PRIVATE_KEY),
  };

  let database: Record<string, unknown>;
  try {
    const result = await client().execute("SELECT COUNT(*) AS n FROM projects");
    database = { ok: true, projects: result.rows[0]?.n ?? null };
  } catch (error) {
    database = {
      ok: false,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      // libSQL wraps the underlying failure; the cause usually names the real
      // problem (bad token, DNS, TLS) where the outer message does not.
      cause:
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : undefined,
    };
  }

  return NextResponse.json({ env, database }, { status: database.ok ? 200 : 503 });
}
