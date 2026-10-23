import { NextResponse } from "next/server";
import { getCurrentActor } from "@/lib/auth/session";
import { getAssetForDownload } from "@/lib/domain/media";
import { readStoredFile } from "@/lib/media/storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  const actor = await getCurrentActor();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { assetId } = await params;
  try {
    const asset = getAssetForDownload(actor, assetId);
    const etag = asset.checksum ? `"${asset.checksum}"` : null;
    if (etag && request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    const buffer = await readStoredFile(asset.storage_path);
    const url = new URL(request.url);
    const download = url.searchParams.get("download") === "1";
    const originalName = asset.original_filename || `homeorbit-${asset.id}`;
    const asciiName = originalName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\\r\n]/g, "_").slice(0, 200);
    const encodedName = encodeURIComponent(originalName)
      .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
      .slice(0, 500);
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": asset.mime_type,
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        ...(etag ? { ETag: etag } : {}),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
}
