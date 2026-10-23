import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/session";
import { listOllamaModels, ollamaDefaultModel, ollamaEmbeddingModel, ollamaVisionModel } from "@/lib/ai/ollama";

export async function GET(): Promise<Response> {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const result = await listOllamaModels();
  return NextResponse.json({
    available: result.available,
    models: result.models,
    error: result.error ?? null,
    defaults: {
      text: ollamaDefaultModel(),
      vision: ollamaVisionModel(),
      embedding: ollamaEmbeddingModel(),
    },
    note: "Model list comes directly from the local Ollama server. Downloads happen on the Mac Studio, never in the browser.",
  });
}
