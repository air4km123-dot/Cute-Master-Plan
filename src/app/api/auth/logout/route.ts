import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

export async function POST() {
  const session = await getSession();
  if (session) {
    await recordAudit({
      actor: session,
      action: "LOGOUT",
      entityType: "SESSION",
      entityId: session.userId,
    });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
