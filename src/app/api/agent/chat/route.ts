import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/session";
import { runAgent } from "@/lib/agent/runner";
import { AppError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/auth/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await getCurrentActor();
  if (!actor) {
    return NextResponse.json({ error: "Please sign in to use the assistant." }, { status: 401 });
  }
  let body: { message?: unknown; conversationId?: unknown };
  try {
    body = (await request.json()) as { message?: unknown; conversationId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message : "";
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  try {
    checkRateLimit(`agent-chat:${actor.id}`, 40, 60);
    const result = await runAgent(actor, { message, conversationId });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const messageText = error instanceof Error ? error.message : "The assistant failed.";
    return NextResponse.json({ error: messageText }, { status });
  }
}
