import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const MEDIA_ROOT = path.resolve(
  process.env.MEDIA_STORAGE_PATH ?? path.join(process.cwd(), "data", "media"),
);

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const MAX_UPLOAD_BYTES = Math.round(envNumber("MEDIA_MAX_UPLOAD_MB", 25) * 1024 * 1024);
export const MEDIA_QUOTA_BYTES = Math.round(envNumber("MEDIA_QUOTA_MB", 2048) * 1024 * 1024);
export const RETENTION_DAYS = Math.round(envNumber("MEDIA_RETENTION_DAYS", 30));

export type DetectedImage = { mime: string; extension: string };

/**
 * Accepts only raster formats that browsers can safely render inline.
 * SVG and anything that is not actually an image is rejected, regardless of
 * the client-provided filename or Content-Type.
 */
export function detectImage(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", extension: "png" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  const header = buffer.subarray(0, 12).toString("ascii");
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
    return { mime: "image/gif", extension: "gif" };
  }
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") {
    return { mime: "image/webp", extension: "webp" };
  }
  if (header.slice(4, 8) === "ftyp" && (header.includes("avif") || header.includes("avis"))) {
    return { mime: "image/avif", extension: "avif" };
  }
  return null;
}

export function ensureMediaRoot(): void {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleaned) throw new Error("Invalid storage segment");
  return cleaned;
}

export type StoredFile = {
  storagePath: string;
  bytes: number;
  checksum: string;
  mime: string;
  extension: string;
};

export async function saveImageBuffer(input: {
  householdId: string;
  memberId: string;
  kind: "upload" | "generated" | "edited";
  buffer: Buffer;
}): Promise<StoredFile> {
  if (input.buffer.length === 0) throw new Error("The uploaded file is empty.");
  if (input.buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Files must be at most ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  const detected = detectImage(input.buffer);
  if (!detected) {
    throw new Error("Unsupported or invalid image. Use PNG, JPEG, WebP, GIF or AVIF.");
  }
  ensureMediaRoot();
  const relative = path.posix.join(
    safeSegment(input.householdId),
    safeSegment(input.memberId),
    input.kind,
    `${crypto.randomUUID()}.${detected.extension}`,
  );
  const absolute = path.join(MEDIA_ROOT, relative);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, input.buffer, { mode: 0o600 });
  return {
    storagePath: relative,
    bytes: input.buffer.length,
    checksum: crypto.createHash("sha256").update(input.buffer).digest("hex"),
    mime: detected.mime,
    extension: detected.extension,
  };
}

export function resolveStoredPath(storagePath: string): string {
  const absolute = path.resolve(MEDIA_ROOT, storagePath);
  const rootWithSeparator = `${MEDIA_ROOT}${path.sep}`;
  if (absolute !== MEDIA_ROOT && !absolute.startsWith(rootWithSeparator)) {
    throw new Error("Invalid media path.");
  }
  return absolute;
}

export async function readStoredFile(storagePath: string): Promise<Buffer> {
  return fsp.readFile(resolveStoredPath(storagePath));
}

export async function deleteStoredFile(storagePath: string): Promise<void> {
  try {
    await fsp.unlink(resolveStoredPath(storagePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function mediaStorageInfo(): { root: string; maxUploadBytes: number; quotaBytes: number; retentionDays: number } {
  return {
    root: MEDIA_ROOT,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    quotaBytes: MEDIA_QUOTA_BYTES,
    retentionDays: RETENTION_DAYS,
  };
}
