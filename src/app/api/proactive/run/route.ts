import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/session";
import { runProactiveChecks } from "@/lib/proactive/insights";

export const dynamic = "force-dynamic";

/**
 * Scheduled entry point for reminders and proactive checks.
 * Protect with PROACTIVE_SECRET (x-proactive-secret header) and call from cron,
 * or call it from an authenticated admin session.
 */
export async function POST(request: Request) {
  const secret = process.env.PROACTIVE_SECRET;
  const provided = request.headers.get("x-proactive-secret");
  let authorized = Boolean(secret && provided && provided === secret);
  if (!authorized) {
    const actor = await getCurrentActor();
    authorized = Boolean(actor?.isAdmin);
  }
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const results = runProactiveChecks();
  return NextResponse.json({ ok: true, results });
}
