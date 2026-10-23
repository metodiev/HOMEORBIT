import { timingSafeEqual } from "node:crypto";
import { statfs } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getDb, get } from "@/lib/db";
import { getCurrentActor } from "@/lib/auth/session";
import { can } from "@/lib/auth/actor";
import { mediaStorageInfo, ensureMediaRoot } from "@/lib/media/storage";
import { comfyuiConfigured, comfyuiHealth } from "@/lib/images/comfyui";
import { listOllamaModels } from "@/lib/ai/ollama";
import { tmdbConfigured } from "@/lib/movies/tmdb";
import { searchConfigured, searchProviderName } from "@/lib/ai/web";

function tokenMatches(request: Request): boolean {
  const expected = process.env.HEALTH_CHECK_TOKEN?.trim();
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : new URL(request.url).searchParams.get("token") ?? "";
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function detailedHealth(householdId?: string) {
  let database = { ok: true, error: null as string | null };
  let counts = { members: 0, mediaAssets: 0, memories: 0, imageJobsQueued: 0, imageJobsRunning: 0 };
  const scoped = householdId ? " AND household_id = ?" : "";
  const values = householdId ? [householdId] : [];
  try {
    getDb().prepare("SELECT 1").get();
    counts = {
      members:
        get<{ count: number }>(
          `SELECT COUNT(*) AS count FROM members WHERE deactivated_at IS NULL${scoped}`,
          values,
        )?.count ?? 0,
      mediaAssets:
        get<{ count: number }>(
          `SELECT COUNT(*) AS count FROM media_assets WHERE deleted_at IS NULL${scoped}`,
          values,
        )?.count ?? 0,
      memories:
        get<{ count: number }>(`SELECT COUNT(*) AS count FROM member_memories WHERE 1 = 1${scoped}`, values)?.count ?? 0,
      imageJobsQueued:
        get<{ count: number }>(
          `SELECT COUNT(*) AS count FROM image_jobs WHERE status = 'queued'${scoped}`,
          values,
        )?.count ?? 0,
      imageJobsRunning:
        get<{ count: number }>(
          `SELECT COUNT(*) AS count FROM image_jobs WHERE status = 'running'${scoped}`,
          values,
        )?.count ?? 0,
    };
  } catch (error) {
    database = { ok: false, error: error instanceof Error ? error.message : "Database check failed." };
  }

  ensureMediaRoot();
  const storage = mediaStorageInfo();
  let disk: { ok: boolean; freeBytes: number | null; totalBytes: number | null } = {
    ok: false,
    freeBytes: null,
    totalBytes: null,
  };
  try {
    const stats = await statfs(storage.root);
    disk = { ok: true, freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
  } catch {
    disk = { ok: false, freeBytes: null, totalBytes: null };
  }

  const [ollama, comfyui] = await Promise.all([listOllamaModels(2500), comfyuiHealth(2500)]);
  const memory = process.memoryUsage();
  const queue = get<{ queued: number; running: number }>(
    `SELECT SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
     FROM image_jobs WHERE 1 = 1${scoped}`,
    values,
  );
  return {
    status: database.ok && disk.ok ? "ok" : "degraded",
    time: new Date().toISOString(),
    database,
    counts,
    storage: {
      path: storage.root,
      maxUploadBytes: storage.maxUploadBytes,
      quotaBytesPerMember: storage.quotaBytes,
      retentionDays: storage.retentionDays,
      disk,
    },
    queue: { queued: queue?.queued ?? 0, running: queue?.running ?? 0 },
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      loadAverage: process.platform === "win32" ? null : (await import("node:os")).loadavg(),
    },
    services: {
      ollama: {
        available: ollama.available,
        models: ollama.models.length,
        error: ollama.error ?? null,
      },
      comfyui: {
        configured: comfyuiConfigured(),
        available: comfyui.available,
        error: comfyui.error ?? null,
      },
      tmdb: { configured: tmdbConfigured() },
      webSearch: { configured: searchConfigured(), provider: searchProviderName() },
    },
  };
}

export async function GET(request: Request): Promise<Response> {
  const actor = await getCurrentActor();
  const tokenAuthorized = tokenMatches(request);
  const authorized = tokenAuthorized || Boolean(actor && (actor.isAdmin || can(actor, "household.manage")));
  if (!authorized) {
    return NextResponse.json({ status: "ok", time: new Date().toISOString() }, { status: 200 });
  }
  try {
    const health = await detailedHealth(tokenAuthorized ? undefined : actor?.householdId);
    return NextResponse.json(health, { status: health.status === "ok" ? 200 : 503 });
  } catch (error) {
    return NextResponse.json(
      { status: "degraded", time: new Date().toISOString(), error: error instanceof Error ? error.message : "Health check failed." },
      { status: 503 },
    );
  }
}
