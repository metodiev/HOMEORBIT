import { all, get, run } from "@/lib/db";
import type { AlbumRow, MediaAssetRow, MemberRow } from "@/lib/db/rows";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso, parseJson, toJson } from "@/lib/util/ids";
import { MEDIA_QUOTA_BYTES, deleteStoredFile, detectImage, saveImageBuffer } from "@/lib/media/storage";
import { recordAudit } from "@/lib/domain/audit";

export type AssetView = MediaAssetRow & {
  ownerName: string;
  ownerColor: string;
  ownerAvatar: string;
  tags: string[];
  metadata: Record<string, unknown>;
  albumNames: string[];
  sharedWith: { memberId: string; name: string }[];
  url: string;
};

const VISIBLE_SQL = `
  SELECT DISTINCT a.* FROM media_assets a
  LEFT JOIN asset_shares s ON s.asset_id = a.id AND s.member_id = ?
  LEFT JOIN album_assets aa ON aa.asset_id = a.id
  LEFT JOIN albums al ON al.id = aa.album_id AND al.deleted_at IS NULL
  LEFT JOIN album_shares als ON als.album_id = al.id AND als.member_id = ?
  WHERE a.household_id = ? AND a.deleted_at IS NULL
    AND (a.owner_member_id = ?
      OR s.member_id IS NOT NULL
      OR (al.visibility = 'family' AND ? != 'relative')
      OR als.member_id IS NOT NULL)
`;

function assetView(row: MediaAssetRow, actor: Actor): AssetView {
  const owner = get<MemberRow>("SELECT * FROM members WHERE id = ?", [row.owner_member_id]);
  const isOwner = row.owner_member_id === actor.id;
  const albumNames = isOwner
    ? all<{ name: string }>(
        `SELECT al.name FROM album_assets aa JOIN albums al ON al.id = aa.album_id
         WHERE aa.asset_id = ? AND al.deleted_at IS NULL ORDER BY al.created_at`,
        [row.id],
      ).map((entry) => entry.name)
    : [];
  const sharedWith = isOwner
    ? all<{ member_id: string; name: string }>(
        `SELECT sh.member_id, m.name FROM asset_shares sh JOIN members m ON m.id = sh.member_id
         WHERE sh.asset_id = ? ORDER BY m.name`,
        [row.id],
      ).map((entry) => ({ memberId: entry.member_id, name: entry.name }))
    : [];
  return {
    ...row,
    ownerName: owner?.name ?? "Unknown",
    ownerColor: owner?.color ?? "#64748b",
    ownerAvatar: owner?.avatar ?? "👤",
    tags: parseJson<string[]>(row.tags_json, []),
    metadata: parseJson<Record<string, unknown>>(row.metadata_json, {}),
    albumNames,
    sharedWith,
    url: `/api/media/${row.id}`,
  };
}

export function canViewAsset(actor: Actor, asset: MediaAssetRow): boolean {
  if (asset.household_id !== actor.householdId || asset.deleted_at) return false;
  if (asset.owner_member_id === actor.id) return true;
  const direct = get<{ asset_id: string }>(
    "SELECT asset_id FROM asset_shares WHERE asset_id = ? AND member_id = ?",
    [asset.id, actor.id],
  );
  if (direct) return true;
  const albums = all<{ visibility: string; owner_member_id: string; shared: number }>(
    `SELECT al.visibility, al.owner_member_id,
            (SELECT COUNT(*) FROM album_shares ash WHERE ash.album_id = al.id AND ash.member_id = ?) AS shared
     FROM album_assets aa JOIN albums al ON al.id = aa.album_id
     WHERE aa.asset_id = ? AND al.deleted_at IS NULL`,
    [actor.id, asset.id],
  );
  return albums.some(
    (album) =>
      album.shared > 0 ||
      (album.visibility === "family" && actor.role !== "relative") ||
      album.owner_member_id === actor.id,
  );
}

export function canViewAlbum(actor: Actor, album: AlbumRow): boolean {
  if (album.household_id !== actor.householdId || album.deleted_at) return false;
  if (album.owner_member_id === actor.id) return true;
  if (album.visibility === "family") return actor.role !== "relative";
  if (album.visibility === "selected") {
    return Boolean(
      get<{ album_id: string }>("SELECT album_id FROM album_shares WHERE album_id = ? AND member_id = ?", [
        album.id,
        actor.id,
      ]),
    );
  }
  return false;
}

function getAssetRow(actor: Actor, assetId: string): MediaAssetRow {
  const asset = get<MediaAssetRow>("SELECT * FROM media_assets WHERE id = ? AND household_id = ?", [
    assetId,
    actor.householdId,
  ]);
  if (!asset || asset.deleted_at) throw new NotFoundError("Image not found.");
  if (!canViewAsset(actor, asset)) throw new ForbiddenError("You cannot access this image.");
  return asset;
}

export function getAsset(actor: Actor, assetId: string): AssetView {
  return assetView(getAssetRow(actor, assetId), actor);
}

export function getAssetForDownload(actor: Actor, assetId: string): MediaAssetRow {
  return getAssetRow(actor, assetId);
}

export function listAssets(
  actor: Actor,
  options: {
    library?: "studio" | "photos";
    search?: string;
    tag?: string;
    albumId?: string;
    favorite?: boolean;
    kind?: "upload" | "generated" | "edited";
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  } = {},
): AssetView[] {
  const params: unknown[] = [actor.id, actor.id, actor.householdId, actor.id, actor.role];
  let clause = "";
  if (options.library) {
    clause += " AND a.library = ?";
    params.push(options.library);
  }
  if (options.kind) {
    clause += " AND a.kind = ?";
    params.push(options.kind);
  }
  if (options.favorite) clause += " AND a.favorite = 1";
  if (options.tag) {
    clause += " AND a.tags_json LIKE ?";
    params.push(`%${options.tag}%`);
  }
  if (options.dateFrom) {
    clause += " AND COALESCE(a.taken_at, a.created_at) >= ?";
    params.push(options.dateFrom);
  }
  if (options.dateTo) {
    clause += " AND COALESCE(a.taken_at, a.created_at) <= ?";
    params.push(`${options.dateTo}T23:59:59.999Z`);
  }
  if (options.albumId) {
    const album = getAlbum(actor, options.albumId);
    clause += " AND a.id IN (SELECT asset_id FROM album_assets WHERE album_id = ?)";
    params.push(album.id);
  }
  if (options.search?.trim()) {
    const term = `%${options.search.trim()}%`;
    clause += ` AND (a.caption LIKE ? OR a.description LIKE ? OR a.original_filename LIKE ? OR a.tags_json LIKE ?)`;
    params.push(term, term, term, term);
  }
  params.push(Math.min(options.limit ?? 200, 500));
  return all<MediaAssetRow>(
    `SELECT * FROM (${VISIBLE_SQL}) a WHERE 1 = 1${clause} ORDER BY a.created_at DESC LIMIT ?`,
    params,
  ).map((row) => assetView(row, actor));
}

function usedBytes(memberId: string): number {
  const row = get<{ total: number | null }>(
    "SELECT SUM(bytes) AS total FROM media_assets WHERE owner_member_id = ?",
    [memberId],
  );
  return row?.total ?? 0;
}

export function storageUsage(actor: Actor): { usedBytes: number; quotaBytes: number; assetCount: number } {
  const row = get<{ total: number | null; count: number }>(
    "SELECT SUM(bytes) AS total, COUNT(*) AS count FROM media_assets WHERE owner_member_id = ? AND deleted_at IS NULL",
    [actor.id],
  );
  return { usedBytes: row?.total ?? 0, quotaBytes: MEDIA_QUOTA_BYTES, assetCount: row?.count ?? 0 };
}

function assertCanCreateMedia(actor: Actor): void {
  if (actor.role === "relative") throw new ForbiddenError("Guest accounts cannot upload or create media.");
}

export function checkQuota(actor: Actor, additionalBytes: number): void {
  if (usedBytes(actor.id) + additionalBytes > MEDIA_QUOTA_BYTES) {
    throw new ValidationError(
      `Storage quota exceeded. Your limit is ${Math.round(MEDIA_QUOTA_BYTES / 1024 / 1024)} MB.`,
    );
  }
}

export async function createUploadedAsset(
  actor: Actor,
  input: {
    buffer: Buffer;
    filename: string;
    library: "studio" | "photos";
    caption?: string | null;
    tags?: string[];
    takenAt?: string | null;
    albumId?: string | null;
  },
): Promise<AssetView> {
  assertCanCreateMedia(actor);
  if (input.buffer.length > 0) checkQuota(actor, input.buffer.length);
  if (input.albumId) {
    const album = getAlbum(actor, input.albumId);
    if (album.owner_member_id !== actor.id) throw new ForbiddenError("Only the album owner can add images.");
  }
  const detected = detectImage(input.buffer);
  if (!detected) throw new ValidationError("Unsupported or invalid image. Use PNG, JPEG, WebP, GIF or AVIF.");
  const stored = await saveImageBuffer({
    householdId: actor.householdId,
    memberId: actor.id,
    kind: "upload",
    buffer: input.buffer,
  });
  const id = newId("img");
  run(
    `INSERT INTO media_assets
      (id, household_id, owner_member_id, kind, library, source_asset_id, storage_path, original_filename,
       mime_type, bytes, checksum, tags_json, caption, metadata_json, taken_at, created_at)
     VALUES (?, ?, ?, 'upload', ?, NULL, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    [
      id,
      actor.householdId,
      actor.id,
      input.library,
      stored.storagePath,
      input.filename.slice(0, 200),
      stored.mime,
      stored.bytes,
      stored.checksum,
      JSON.stringify(input.tags ?? []),
      input.caption ?? null,
      input.takenAt ?? null,
      nowIso(),
    ],
  );
  if (input.albumId) addAssetToAlbum(actor, input.albumId, id);
  recordAudit(actor, "media.uploaded", "media_asset", id, { library: input.library, bytes: stored.bytes });
  return getAsset(actor, id);
}

export async function createDerivedAsset(input: {
  actor: Actor;
  buffer: Buffer;
  kind: "generated" | "edited";
  library: "studio" | "photos";
  sourceAssetId: string | null;
  prompt: string;
  workflowName: string;
  workflowId: string | null;
  provider: string;
  modelLabel: string | null;
  operation: string;
  albumId?: string | null;
  externalJobId?: string | null;
}): Promise<MediaAssetRow> {
  const { actor } = input;
  checkQuota(actor, input.buffer.length);
  const detected = detectImage(input.buffer);
  if (!detected) throw new ValidationError("The image workflow returned an invalid image.");
  const stored = await saveImageBuffer({
    householdId: actor.householdId,
    memberId: actor.id,
    kind: input.kind,
    buffer: input.buffer,
  });
  const id = newId("img");
  const metadata = {
    prompt: input.prompt,
    workflowName: input.workflowName,
    workflowId: input.workflowId,
    provider: input.provider,
    model: input.modelLabel,
    operation: input.operation,
    externalJobId: input.externalJobId ?? null,
    generatedAt: nowIso(),
  };
  run(
    `INSERT INTO media_assets
      (id, household_id, owner_member_id, kind, library, source_asset_id, storage_path, original_filename,
       mime_type, bytes, checksum, tags_json, caption, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, '[]', ?, ?, ?)`,
    [
      id,
      actor.householdId,
      actor.id,
      input.kind,
      input.library,
      input.sourceAssetId,
      stored.storagePath,
      stored.mime,
      stored.bytes,
      stored.checksum,
      input.prompt.slice(0, 200),
      JSON.stringify(metadata),
      nowIso(),
    ],
  );
  if (input.albumId) {
    try {
      addAssetToAlbum(actor, input.albumId, id);
    } catch {
      // Album access may have changed while the job ran; the image is still saved.
    }
  }
  recordAudit(actor, "media.generated", "media_asset", id, {
    operation: input.operation,
    workflow: input.workflowName,
    provider: input.provider,
  });
  return get<MediaAssetRow>("SELECT * FROM media_assets WHERE id = ?", [id]) as MediaAssetRow;
}

export function updateAssetMetadata(
  actor: Actor,
  assetId: string,
  input: { caption?: string | null; description?: string | null; tags?: string[]; favorite?: boolean; takenAt?: string | null },
): AssetView {
  const asset = getAssetRow(actor, assetId);
  if (asset.owner_member_id !== actor.id) throw new ForbiddenError("Only the owner can change this image.");
  run(
    `UPDATE media_assets SET caption = ?, description = ?, tags_json = ?, favorite = ?, taken_at = ? WHERE id = ?`,
    [
      input.caption !== undefined ? input.caption : asset.caption,
      input.description !== undefined ? input.description : asset.description,
      input.tags !== undefined ? JSON.stringify(input.tags.slice(0, 20)) : asset.tags_json,
      input.favorite !== undefined ? (input.favorite ? 1 : 0) : asset.favorite,
      input.takenAt !== undefined ? input.takenAt : asset.taken_at,
      asset.id,
    ],
  );
  recordAudit(actor, "media.metadata_updated", "media_asset", asset.id);
  return getAsset(actor, asset.id);
}

export function setAssetDescription(assetId: string, description: string): void {
  run("UPDATE media_assets SET description = ? WHERE id = ?", [description, assetId]);
}

export function deleteAsset(actor: Actor, assetId: string): void {
  const asset = getAssetRow(actor, assetId);
  if (asset.owner_member_id !== actor.id) throw new ForbiddenError("Only the owner can delete this image.");
  run("UPDATE media_assets SET deleted_at = ? WHERE id = ?", [nowIso(), asset.id]);
  recordAudit(actor, "media.deleted", "media_asset", asset.id);
}

/** Permanently removes soft-deleted files older than the retention window. */
export function purgeDeletedAssets(retentionDays: number): Promise<{ removed: number; bytes: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const rows = all<MediaAssetRow>(
    "SELECT * FROM media_assets WHERE deleted_at IS NOT NULL AND deleted_at < ?",
    [cutoff],
  );
  let bytes = 0;
  return (async () => {
    for (const row of rows) {
      await deleteStoredFile(row.storage_path);
      run("DELETE FROM media_assets WHERE id = ?", [row.id]);
      bytes += row.bytes;
    }
    return { removed: rows.length, bytes };
  })();
}

export function shareAsset(actor: Actor, assetId: string, memberIds: string[]): void {
  const asset = getAssetRow(actor, assetId);
  if (asset.owner_member_id !== actor.id) throw new ForbiddenError("Only the owner can share this image.");
  for (const memberId of [...new Set(memberIds)]) {
    const member = get<MemberRow>(
      "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
      [memberId, actor.householdId],
    );
    if (!member) throw new ValidationError("That family member does not exist.");
    run(
      "INSERT OR IGNORE INTO asset_shares (asset_id, member_id, created_at) VALUES (?, ?, ?)",
      [asset.id, member.id, nowIso()],
    );
  }
  recordAudit(actor, "media.shared", "media_asset", asset.id, { memberIds });
}

export function unshareAsset(actor: Actor, assetId: string, memberId: string): void {
  const asset = getAssetRow(actor, assetId);
  if (asset.owner_member_id !== actor.id) throw new ForbiddenError("Only the owner can change sharing.");
  run("DELETE FROM asset_shares WHERE asset_id = ? AND member_id = ?", [asset.id, memberId]);
  recordAudit(actor, "media.unshared", "media_asset", asset.id, { memberId });
}

// ------------------------------- albums -------------------------------

export type AlbumView = AlbumRow & {
  assetCount: number;
  coverAssetId: string | null;
  ownerName: string;
  sharedWith: { memberId: string; name: string }[];
};

export function listAlbums(actor: Actor, library: "studio" | "photos" = "photos"): AlbumView[] {
  const rows = all<AlbumRow>(
    `SELECT DISTINCT al.* FROM albums al
     LEFT JOIN album_shares ash ON ash.album_id = al.id AND ash.member_id = ?
     WHERE al.household_id = ? AND al.deleted_at IS NULL
       AND (al.owner_member_id = ? OR (al.visibility = 'family' AND ? != 'relative') OR ash.member_id IS NOT NULL)
     ORDER BY al.created_at DESC`,
    [actor.id, actor.householdId, actor.id, actor.role],
  );
  return rows
    .filter((album) => {
      // Studio and photo albums are distinguished by the assets they contain.
      const count = get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM album_assets aa JOIN media_assets a ON a.id = aa.asset_id
         WHERE aa.album_id = ? AND a.library = ? AND a.deleted_at IS NULL`,
        [album.id, library],
      );
      return (count?.count ?? 0) > 0 || album.owner_member_id === actor.id;
    })
    .map((album) => {
      const owner = get<MemberRow>("SELECT * FROM members WHERE id = ?", [album.owner_member_id]);
      const count = get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM album_assets aa JOIN media_assets a ON a.id = aa.asset_id
         WHERE aa.album_id = ? AND a.deleted_at IS NULL`,
        [album.id],
      );
      const cover = get<{ asset_id: string }>(
        `SELECT aa.asset_id FROM album_assets aa JOIN media_assets a ON a.id = aa.asset_id
         WHERE aa.album_id = ? AND a.deleted_at IS NULL ORDER BY aa.added_at DESC LIMIT 1`,
        [album.id],
      );
      const sharedWith =
        album.owner_member_id === actor.id
          ? all<{ member_id: string; name: string }>(
              `SELECT ash.member_id, m.name FROM album_shares ash JOIN members m ON m.id = ash.member_id WHERE ash.album_id = ?`,
              [album.id],
            ).map((entry) => ({ memberId: entry.member_id, name: entry.name }))
          : [];
      return {
        ...album,
        assetCount: count?.count ?? 0,
        coverAssetId: cover?.asset_id ?? null,
        ownerName: owner?.name ?? "Unknown",
        sharedWith,
      };
    });
}

export function getAlbum(actor: Actor, albumId: string): AlbumRow {
  const album = get<AlbumRow>("SELECT * FROM albums WHERE id = ? AND household_id = ?", [
    albumId,
    actor.householdId,
  ]);
  if (!album || album.deleted_at) throw new NotFoundError("Album not found.");
  if (!canViewAlbum(actor, album)) throw new ForbiddenError("You cannot access this album.");
  return album;
}

export function createAlbum(
  actor: Actor,
  input: { name: string; visibility?: "private" | "family" | "selected"; memberIds?: string[] },
): AlbumRow {
  assertCanCreateMedia(actor);
  const name = input.name.trim();
  if (!name) throw new ValidationError("An album needs a name.");
  const id = newId("alb");
  run("INSERT INTO albums (id, household_id, owner_member_id, name, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    actor.householdId,
    actor.id,
    name,
    input.visibility ?? "private",
    nowIso(),
  ]);
  for (const memberId of input.memberIds ?? []) {
    const member = get<MemberRow>(
      "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
      [memberId, actor.householdId],
    );
    if (member) {
      run("INSERT OR IGNORE INTO album_shares (album_id, member_id) VALUES (?, ?)", [id, member.id]);
    }
  }
  recordAudit(actor, "album.created", "album", id, { visibility: input.visibility ?? "private" });
  return get<AlbumRow>("SELECT * FROM albums WHERE id = ?", [id]) as AlbumRow;
}

export function addAssetToAlbum(actor: Actor, albumId: string, assetId: string): void {
  const album = getAlbum(actor, albumId);
  if (album.owner_member_id !== actor.id) throw new ForbiddenError("Only the album owner can add images.");
  const asset = getAssetRow(actor, assetId);
  if (asset.owner_member_id !== actor.id) throw new ForbiddenError("Only your own images can be added.");
  run("INSERT OR IGNORE INTO album_assets (album_id, asset_id, added_at) VALUES (?, ?, ?)", [
    album.id,
    asset.id,
    nowIso(),
  ]);
  recordAudit(actor, "album.asset_added", "album", album.id, { assetId });
}

export function removeAssetFromAlbum(actor: Actor, albumId: string, assetId: string): void {
  const album = getAlbum(actor, albumId);
  if (album.owner_member_id !== actor.id) throw new ForbiddenError("Only the album owner can change images.");
  run("DELETE FROM album_assets WHERE album_id = ? AND asset_id = ?", [album.id, assetId]);
  recordAudit(actor, "album.asset_removed", "album", album.id, { assetId });
}

export function shareAlbum(actor: Actor, albumId: string, memberIds: string[], visibility?: "private" | "family" | "selected"): AlbumRow {
  const album = get<AlbumRow>("SELECT * FROM albums WHERE id = ? AND household_id = ?", [albumId, actor.householdId]);
  if (!album || album.deleted_at) throw new NotFoundError("Album not found.");
  if (album.owner_member_id !== actor.id) throw new ForbiddenError("Only the album owner can share it.");
  if (visibility) {
    run("UPDATE albums SET visibility = ? WHERE id = ?", [visibility, album.id]);
    run("DELETE FROM album_shares WHERE album_id = ?", [album.id]);
  }
  for (const memberId of [...new Set(memberIds)]) {
    const member = get<MemberRow>(
      "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
      [memberId, actor.householdId],
    );
    if (!member) throw new ValidationError("That family member does not exist.");
    run("INSERT OR IGNORE INTO album_shares (album_id, member_id) VALUES (?, ?)", [album.id, member.id]);
  }
  recordAudit(actor, "album.shared", "album", album.id, { memberIds, visibility: visibility ?? album.visibility });
  return get<AlbumRow>("SELECT * FROM albums WHERE id = ?", [album.id]) as AlbumRow;
}

export function deleteAlbum(actor: Actor, albumId: string): void {
  const album = getAlbum(actor, albumId);
  if (album.owner_member_id !== actor.id) throw new ForbiddenError("Only the album owner can delete it.");
  run("UPDATE albums SET deleted_at = ? WHERE id = ?", [nowIso(), album.id]);
  recordAudit(actor, "album.deleted", "album", album.id);
}

export function albumAssets(actor: Actor, albumId: string): AssetView[] {
  const album = getAlbum(actor, albumId);
  return all<MediaAssetRow>(
    `SELECT a.* FROM media_assets a JOIN album_assets aa ON aa.asset_id = a.id
     WHERE aa.album_id = ? AND a.deleted_at IS NULL ORDER BY aa.added_at DESC`,
    [album.id],
  )
    .filter((asset) => canViewAsset(actor, asset))
    .map((row) => assetView(row, actor));
}

export function visibleAssetsForEmbedding(actor: Actor, limit = 500): MediaAssetRow[] {
  return all<MediaAssetRow>(
    `SELECT * FROM (${VISIBLE_SQL}) a WHERE a.library = 'photos' AND a.deleted_at IS NULL LIMIT ?`,
    [actor.id, actor.id, actor.householdId, actor.id, actor.role, limit],
  );
}

export function assetOwner(asset: MediaAssetRow): string {
  return asset.owner_member_id;
}

export function assetTags(row: MediaAssetRow): string[] {
  return parseJson<string[]>(row.tags_json, []);
}

export function assetMetadata(row: MediaAssetRow): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(row.metadata_json, {});
}

export function setAssetTags(assetId: string, tags: string[]): void {
  run("UPDATE media_assets SET tags_json = ? WHERE id = ?", [toJson(tags.slice(0, 20)), assetId]);
}
