import type { AlbumView, AssetView } from "@/lib/domain/media";
import type { MemberRow } from "@/lib/db/rows";
import {
  addAssetToAlbumAction,
  deleteAssetAction,
  describePhotoAction,
  shareAssetAction,
  updateAssetAction,
} from "@/lib/actions";
import { Badge } from "@/components/ui";

export function MediaAssetCard({
  asset,
  members,
  albums,
  currentMemberId,
  redirectTo,
  allowDescribe = false,
}: {
  asset: AssetView;
  members: MemberRow[];
  albums: AlbumView[];
  currentMemberId: string;
  redirectTo: string;
  allowDescribe?: boolean;
}) {
  const owned = asset.owner_member_id === currentMemberId;
  const prompt = (asset.metadata.prompt as string | undefined) ?? null;
  const workflow = (asset.metadata.workflowName as string | undefined) ?? null;
  const operation = (asset.metadata.operation as string | undefined) ?? null;

  return (
    <article className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
      <a href={asset.url} target="_blank" rel="noreferrer" className="block bg-sand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={asset.url} alt={asset.caption ?? asset.description ?? "Family image"} className="h-52 w-full object-cover" />
      </a>
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={asset.kind === "upload" ? "neutral" : asset.kind === "generated" ? "teal" : "blue"}>{asset.kind}</Badge>
          {asset.favorite === 1 ? <Badge tone="amber">★ favourite</Badge> : null}
          {asset.sharedWith.length > 0 ? <Badge tone="blue">shared with {asset.sharedWith.length}</Badge> : null}
          {asset.albumNames.length > 0 ? <Badge tone="neutral">{asset.albumNames.join(", ")}</Badge> : null}
        </div>
        <p className="text-sm font-semibold text-ink">{asset.caption || asset.original_filename || "Untitled image"}</p>
        <p className="text-[11px] text-ink-soft">
          {asset.ownerAvatar} {asset.ownerName} · {new Date(asset.created_at).toLocaleDateString()} ·{" "}
          {Math.round(asset.bytes / 1024)} KB
        </p>
        {asset.description ? <p className="text-xs leading-relaxed text-ink-soft">{asset.description}</p> : null}
        {prompt ? <p className="line-clamp-2 text-[11px] text-ink-soft">Prompt: {prompt}</p> : null}
        {workflow || operation ? (
          <p className="text-[10px] uppercase tracking-wide text-ink-soft">
            {[workflow, operation?.replace(/_/g, " "), asset.metadata.model as string | undefined].filter(Boolean).join(" · ")}
          </p>
        ) : null}
        {asset.source_asset_id ? <p className="text-[10px] text-ink-soft">Edited from another original — both versions are kept.</p> : null}
        {asset.tags.length > 0 ? (
          <p className="flex flex-wrap gap-1">
            {asset.tags.map((tag) => (
              <span key={tag} className="chip text-[10px]">
                #{tag}
              </span>
            ))}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={`${asset.url}?download=1`} className="btn-secondary px-2 py-1 text-[11px]">
            Download
          </a>
          {allowDescribe && owned ? (
            <form action={describePhotoAction}>
              <input type="hidden" name="assetId" value={asset.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <button type="submit" className="btn-secondary px-2 py-1 text-[11px]">
                Describe locally
              </button>
            </form>
          ) : null}
        </div>
        {owned ? (
          <details className="pt-1 text-xs">
            <summary className="cursor-pointer text-ink-soft hover:text-teal">Manage image</summary>
            <form action={updateAssetAction} className="mt-2 space-y-2">
              <input type="hidden" name="assetId" value={asset.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input name="caption" defaultValue={asset.caption ?? ""} placeholder="Caption" className="field mt-0" />
              <input name="tags" defaultValue={asset.tags.join(", ")} placeholder="Tags, comma separated" className="field mt-0" />
              <label className="flex items-center gap-2 text-[11px]">
                <input type="checkbox" name="favorite" defaultChecked={asset.favorite === 1} /> Favourite
              </label>
              <input type="hidden" name="favoriteForm" value="1" />
              <button type="submit" className="btn-secondary w-full py-1 text-[11px]">
                Save details
              </button>
            </form>
            {albums.length > 0 ? (
              <form action={addAssetToAlbumAction} className="mt-2 flex items-end gap-1">
                <input type="hidden" name="assetId" value={asset.id} />
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <select name="albumId" className="field mt-0 flex-1 py-1 text-[11px]" defaultValue="">
                  <option value="" disabled>
                    Add to album…
                  </option>
                  {albums.map((album) => (
                    <option key={album.id} value={album.id}>
                      {album.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">
                  Add
                </button>
              </form>
            ) : null}
            <details className="mt-2 rounded-xl bg-sand/60 p-2">
              <summary className="cursor-pointer text-[11px] font-semibold">Share with specific people</summary>
              <form action={shareAssetAction} className="mt-2 space-y-1">
                <input type="hidden" name="assetId" value={asset.id} />
                <input type="hidden" name="redirectTo" value={redirectTo} />
                {members
                  .filter((member) => member.id !== currentMemberId)
                  .map((member) => (
                    <label key={member.id} className="flex items-center gap-2 text-[11px]">
                      <input type="checkbox" name="memberIds" value={member.id} /> {member.name}
                    </label>
                  ))}
                <p className="text-[10px] text-ink-soft">Sharing is explicit, per image. Family albums are separate.</p>
                <button type="submit" className="btn-secondary w-full py-1 text-[11px]">
                  Share image
                </button>
              </form>
            </details>
            {asset.sharedWith.length > 0 ? (
              <p className="mt-2 text-[10px] text-ink-soft">Shared with: {asset.sharedWith.map((entry) => entry.name).join(", ")}</p>
            ) : null}
            <form action={deleteAssetAction} className="mt-2">
              <input type="hidden" name="assetId" value={asset.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <button type="submit" className="text-[11px] text-red-700 hover:underline">
                Delete image
              </button>
            </form>
          </details>
        ) : null}
      </div>
    </article>
  );
}
