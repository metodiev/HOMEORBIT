import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/session";
import { AppError, toErrorMessage } from "@/lib/errors";
import { cancelImageJob, getImageJob } from "@/lib/images/queue";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { jobId } = await params;
  try {
    return NextResponse.json({ job: getImageJob(actor, jobId) });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: toErrorMessage(error) }, { status });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { jobId } = await params;
  try {
    cancelImageJob(actor, jobId);
    return NextResponse.json({ ok: true, job: getImageJob(actor, jobId) });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: toErrorMessage(error) }, { status });
  }
}
