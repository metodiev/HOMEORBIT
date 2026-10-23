import { all } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { requireActor } from "@/lib/auth/session";
import { t } from "@/lib/i18n";
import { createAlbumAction, deleteAlbumAction, shareAlbumAction, uploadAssetAction } from "@/lib/actions";
import { listAlbums } from "@/lib/domain/media";
import { searchPhotos } from "@/lib/domain/photos";
import { ollamaEmbeddingModel, ollamaVisionModel } from "@/lib/ai/ollama";
import { Card, EmptyState, FeedbackBanner, GuestRestricted, PageHeader } from "@/components/ui";
import { MediaAssetCard } from "@/components/MediaAssetCard";

export const metadata = { title: "Family photos" };

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string; tag?: string; favorite?: string; ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  if (actor.role === "relative") {
    return (
      <>
        <PageHeader eyebrow="Private library" title={t(actor.locale, "photos.title")} />
        <GuestRestricted title="Family photos" />
      </>
    );
  }
  const result = await searchPhotos(actor, {
    query: params.q,
    dateFrom: params.from,
    dateTo: params.to,
    tag: params.tag,
    favorite: params.favorite === "1",
  });
  const albums = listAlbums(actor, "photos");
  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [actor.householdId],
  );
  const visionModel = ollamaVisionModel();
  const embeddingModel = ollamaEmbeddingModel();

  return (
    <>
      <PageHeader
        eyebrow="Private photo library"
        title={t(actor.locale, "photos.title")}
        subtitle={t(actor.locale, "photos.subtitle")}
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <Card className="mb-5">
        <form method="get" action="/photos" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <input name="q" defaultValue={params.q ?? ""} placeholder="Search captions, descriptions, filenames or tags" className="field mt-0 lg:col-span-2" />
          <input name="from" type="date" defaultValue={params.from ?? ""} className="field mt-0" aria-label="From date" />
          <input name="to" type="date" defaultValue={params.to ?? ""} className="field mt-0" aria-label="To date" />
          <input name="tag" defaultValue={params.tag ?? ""} placeholder="Tag" className="field mt-0" />
          <div className="flex gap-2">
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="favorite" value="1" defaultChecked={params.favorite === "1"} /> ★
            </label>
            <button type="submit" className="btn-secondary flex-1">
              Search
            </button>
          </div>
        </form>
        <p className="mt-2 text-[11px] text-ink-soft">
          {result.note} Only images you are authorized to see are searched. Descriptions never identify people.
        </p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">
              {params.q || params.tag || params.from || params.to ? "Search results" : "All photos"}
            </h2>
            <span className="text-xs text-ink-soft">
              {result.assets.length} photo(s) · {result.mode === "semantic" ? "semantic + text" : "metadata search"}
            </span>
          </div>
          {result.assets.length === 0 ? (
            <EmptyState
              icon="🖼️"
              title="No photos match"
              description="Upload a photo, adjust the filters, or describe a photo so it can be found with local semantic search."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {result.assets.map((asset) => (
                <MediaAssetCard
                  key={asset.id}
                  asset={asset}
                  members={members}
                  albums={albums.filter((album) => album.owner_member_id === actor.id)}
                  currentMemberId={actor.id}
                  redirectTo="/photos"
                  allowDescribe={Boolean(visionModel)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Upload photos" subtitle="Original files are stored separately from edited versions.">
            <form action={uploadAssetAction} className="space-y-2">
              <input type="hidden" name="library" value="photos" />
              <input type="hidden" name="redirectTo" value="/photos" />
              <input type="file" name="file" required accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="block w-full text-xs" />
              <input name="caption" placeholder="Caption" className="field mt-0" />
              <input name="tags" placeholder="Tags, comma separated" className="field mt-0" />
              <input name="takenAt" type="date" className="field mt-0" />
              <select name="albumId" className="field mt-0" defaultValue="">
                <option value="">No album</option>
                {albums
                  .filter((album) => album.owner_member_id === actor.id)
                  .map((album) => (
                    <option key={album.id} value={album.id}>
                      {album.name}
                    </option>
                  ))}
              </select>
              <button type="submit" className="btn w-full">
                Upload photo
              </button>
            </form>
          </Card>

          <Card title="Local photo intelligence" subtitle="Opt-in descriptions and semantic search.">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>👁️ Vision model: {visionModel ? <strong className="text-ink">{visionModel}</strong> : "not configured"}</li>
              <li>🧠 Embedding model: {embeddingModel ? <strong className="text-ink">{embeddingModel}</strong> : "not configured"}</li>
              <li>Only the owner can generate a description. It is stored with the photo and can be searched by people who can already see that photo.</li>
              <li>No face recognition, no biometric profiles, no automatic identity labels. Ever.</li>
            </ul>
            {!visionModel || !embeddingModel ? (
              <p className="mt-2 rounded-xl bg-amber-50 p-2 text-[11px] text-amber-900">
                Ask the administrator to set <code>OLLAMA_VISION_MODEL</code> and <code>OLLAMA_EMBED_MODEL</code> for local
                descriptions and semantic search.
              </p>
            ) : null}
          </Card>

          <Card title="Photo albums" subtitle="Private by default; family albums are explicit.">
            {albums.length === 0 ? <p className="text-xs text-ink-soft">No photo albums yet.</p> : null}
            <div className="space-y-2">
              {albums.map((album) => (
                <details key={album.id} className="rounded-xl border border-black/5 p-2 text-xs">
                  <summary className="cursor-pointer">
                    <strong>{album.name}</strong> · {album.visibility} · {album.assetCount} photo(s)
                  </summary>
                  {album.sharedWith.length > 0 ? (
                    <p className="mt-1 text-[11px] text-ink-soft">Shared with {album.sharedWith.map((entry) => entry.name).join(", ")}</p>
                  ) : null}
                  {album.owner_member_id === actor.id ? (
                    <>
                      <form action={shareAlbumAction} className="mt-2 space-y-1">
                        <input type="hidden" name="albumId" value={album.id} />
                        <input type="hidden" name="redirectTo" value="/photos" />
                        <select name="visibility" defaultValue={album.visibility} className="field mt-0 py-1">
                          <option value="private">Private</option>
                          <option value="family">Family album</option>
                          <option value="selected">Selected people</option>
                        </select>
                        {members
                          .filter((member) => member.id !== actor.id)
                          .map((member) => (
                            <label key={member.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                name="memberIds"
                                value={member.id}
                                defaultChecked={album.sharedWith.some((entry) => entry.memberId === member.id)}
                              />{" "}
                              {member.name}
                            </label>
                          ))}
                        <button type="submit" className="btn-secondary w-full py-1">
                          Update sharing
                        </button>
                      </form>
                      <form action={deleteAlbumAction} className="mt-1">
                        <input type="hidden" name="albumId" value={album.id} />
                        <input type="hidden" name="redirectTo" value="/photos" />
                        <button type="submit" className="text-[11px] text-red-700 hover:underline">
                          Delete album
                        </button>
                      </form>
                    </>
                  ) : (
                    <p className="mt-1 text-[10px] text-ink-soft">Owned by {album.ownerName}. Only the owner can change it.</p>
                  )}
                </details>
              ))}
            </div>
            <form action={createAlbumAction} className="mt-3 space-y-2 border-t border-black/5 pt-3">
              <input type="hidden" name="library" value="photos" />
              <input type="hidden" name="redirectTo" value="/photos" />
              <input name="name" required placeholder="New photo album" className="field mt-0" />
              <select name="visibility" defaultValue="private" className="field mt-0">
                <option value="private">Private</option>
                <option value="family">Family album</option>
                <option value="selected">Selected people</option>
              </select>
              <button type="submit" className="btn-secondary w-full">
                Create album
              </button>
            </form>
          </Card>

          <Card title="Retention & export">
            <p className="text-xs leading-relaxed text-ink-soft">
              Deleted images enter a retention window before permanent purge. Each image has a download link and your account
              data can be exported from Settings. Household backups must include both the SQLite database and the media folder.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
