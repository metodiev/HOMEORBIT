import { all } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/auth/actor";
import { t } from "@/lib/i18n";
import { listAlbums, listAssets, storageUsage } from "@/lib/domain/media";
import { listWorkflows } from "@/lib/domain/image-workflows";
import { imageQueueInfo, listImageJobs, processImageQueue } from "@/lib/images/queue";
import { comfyuiConfigured } from "@/lib/images/comfyui";
import {
  createAlbumAction,
  deleteAlbumAction,
  enqueueImageJobAction,
  shareAlbumAction,
  uploadAssetAction,
} from "@/lib/actions";
import { Card, EmptyState, FeedbackBanner, GuestRestricted, PageHeader, Stat } from "@/components/ui";
import { MediaAssetCard } from "@/components/MediaAssetCard";
import { ImageJobMonitor } from "@/components/ImageJobMonitor";

export const metadata = { title: "Image Studio" };

const OPERATIONS = [
  { value: "text_to_image", label: "Text to image", needsSource: false },
  { value: "image_to_image", label: "Image to image", needsSource: true },
  { value: "inpaint", label: "Inpaint with a mask", needsSource: true },
  { value: "background_replace", label: "Replace background", needsSource: true },
  { value: "remove_object", label: "Remove an object", needsSource: true },
  { value: "restore", label: "Restore old photo", needsSource: true },
  { value: "upscale", label: "Upscale", needsSource: true },
];

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  if (actor.role === "relative") {
    return (
      <>
        <PageHeader eyebrow="Local media" title={t(actor.locale, "studio.title")} />
        <GuestRestricted title="Image Studio" />
      </>
    );
  }
  const canManage = can(actor, "household.manage");
  const workflows = listWorkflows(actor, { includeDisabled: canManage });
  const assets = listAssets(actor, { library: "studio", limit: 60 });
  const sourceAssets = listAssets(actor, { limit: 100 });
  const albums = listAlbums(actor, "studio");
  const jobs = listImageJobs(actor, 12);
  const queue = imageQueueInfo(actor);
  const usage = storageUsage(actor);
  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [actor.householdId],
  );
  const comfyConfigured = comfyuiConfigured();
  const usagePercent = Math.min(100, Math.round((usage.usedBytes / usage.quotaBytes) * 100));
  if (comfyConfigured && queue.queued > 0) void processImageQueue().catch(() => undefined);

  return (
    <>
      <PageHeader
        eyebrow="ComfyUI on the Mac Studio"
        title={t(actor.locale, "studio.title")}
        subtitle={t(actor.locale, "studio.subtitle")}
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Queued" value={queue.queued} hint="Runs one at a time" />
        <Stat label="Running" value={queue.running} hint="ComfyUI worker" />
        <Stat label="Storage" value={`${Math.round(usage.usedBytes / 1024 / 1024)} MB`} hint={`${usagePercent}% of quota`} />
        <Stat label="Workflows" value={workflows.filter((workflow) => workflow.enabled === 1).length} hint="Enabled for this household" />
      </div>

      {!comfyConfigured ? (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>ComfyUI is not configured.</strong> Set <code>COMFYUI_URL</code> on the server, make sure ComfyUI is running, then
          add and enable at least one workflow in Settings. Uploads and galleries still work without it.
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card title="Generate an image" subtitle="Local inference through an authorized ComfyUI workflow.">
            <form action={enqueueImageJobAction} className="space-y-3">
              <input type="hidden" name="redirectTo" value="/studio" />
              <div>
                <label className="label" htmlFor="prompt">
                  What should the image show?
                </label>
                <textarea id="prompt" name="prompt" required rows={4} className="field" placeholder="A quiet reading corner by a window, autumn light, warm wood, soft textures" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="operation">
                    Operation
                  </label>
                  <select id="operation" name="operation" className="field" defaultValue="text_to_image">
                    {OPERATIONS.map((operation) => (
                      <option key={operation.value} value={operation.value}>
                        {operation.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="workflowId">
                    Workflow
                  </label>
                  <select id="workflowId" name="workflowId" className="field" defaultValue="">
                    <option value="">First enabled workflow for the operation</option>
                    {workflows
                      .filter((workflow) => workflow.enabled === 1)
                      .map((workflow) => (
                        <option key={workflow.id} value={workflow.id}>
                          {workflow.name} · {workflow.operation.replace(/_/g, " ")}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="sourceAssetId">
                  Source image for edits
                </label>
                <select id="sourceAssetId" name="sourceAssetId" className="field" defaultValue="">
                  <option value="">No source (text to image)</option>
                  {sourceAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.caption ?? asset.original_filename ?? asset.id} · {asset.kind}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-xl bg-sand/60 p-3">
                <p className="mb-2 text-[11px] font-semibold text-ink-soft">
                  Edits can use a mask: white/transparent areas mark what changes. Mask uploads are stored privately.
                </p>
                <input type="file" name="mask" accept="image/png,image/jpeg,image/webp" className="block w-full text-xs" />
              </div>
              <details className="rounded-xl border border-black/5 p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-ink-soft">Advanced parameters</summary>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <label>
                    Width
                    <input name="width" type="number" min={256} max={2048} defaultValue={1024} className="field mt-0" />
                  </label>
                  <label>
                    Height
                    <input name="height" type="number" min={256} max={2048} defaultValue={1024} className="field mt-0" />
                  </label>
                  <label>
                    Steps
                    <input name="steps" type="number" min={1} max={100} defaultValue={25} className="field mt-0" />
                  </label>
                  <label>
                    CFG
                    <input name="cfg" type="number" min={1} max={30} step={0.5} defaultValue={7} className="field mt-0" />
                  </label>
                  <label>
                    Edit strength
                    <input name="denoise" type="number" min={0.1} max={1} step={0.05} defaultValue={0.65} className="field mt-0" />
                  </label>
                  <label>
                    Upscale
                    <input name="scale" type="number" min={1} max={8} step={0.5} defaultValue={2} className="field mt-0" />
                  </label>
                  <label>
                    Seed
                    <input name="seed" type="number" min={0} className="field mt-0" placeholder="random" />
                  </label>
                  <label className="col-span-2">
                    Checkpoint override
                    <input name="checkpoint" className="field mt-0" placeholder="uses COMFYUI_CHECKPOINT" />
                  </label>
                </div>
              </details>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="negativePrompt">
                    Avoid
                  </label>
                  <input id="negativePrompt" name="negativePrompt" className="field" placeholder="blurry, text, extra fingers" />
                </div>
                <div>
                  <label className="label" htmlFor="albumId">
                    Add result to album
                  </label>
                  <select id="albumId" name="albumId" className="field" defaultValue="">
                    <option value="">No album</option>
                    {albums
                      .filter((album) => album.owner_member_id === actor.id)
                      .map((album) => (
                        <option key={album.id} value={album.id}>
                          {album.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <button type="submit" className="btn w-full" disabled={!comfyConfigured}>
                Queue local image
              </button>
            </form>
          </Card>

          <Card title="Generation history" subtitle="Real queue status from the local worker. Results stay private until shared.">
            <ImageJobMonitor initialJobs={jobs} />
          </Card>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Private library</h2>
              <span className="text-xs text-ink-soft">{assets.length} visible image(s)</span>
            </div>
            {assets.length === 0 ? (
              <EmptyState icon="🎨" title="Nothing here yet" description="Upload a photo or queue your first local generation." />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {assets.map((asset) => (
                  <MediaAssetCard
                    key={asset.id}
                    asset={asset}
                    members={members}
                    albums={albums.filter((album) => album.owner_member_id === actor.id)}
                    currentMemberId={actor.id}
                    redirectTo="/studio"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <Card title="Upload an image" subtitle="Validated by file signature, 25 MB limit, private by default.">
            <form action={uploadAssetAction} className="space-y-2">
              <input type="hidden" name="library" value="studio" />
              <input type="hidden" name="redirectTo" value="/studio" />
              <input type="file" name="file" required accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="block w-full text-xs" />
              <input name="caption" placeholder="Caption" className="field mt-0" />
              <input name="tags" placeholder="Tags, comma separated" className="field mt-0" />
              <input name="takenAt" type="date" className="field mt-0" />
              <button type="submit" className="btn-secondary w-full">
                Upload
              </button>
            </form>
          </Card>

          <Card title="Albums" subtitle="Share with named people, or make a family album.">
            {albums.length === 0 ? <p className="text-xs text-ink-soft">No Studio albums yet.</p> : null}
            <div className="space-y-2">
              {albums.map((album) => (
                <details key={album.id} className="rounded-xl border border-black/5 p-2 text-xs">
                  <summary className="cursor-pointer">
                    <strong>{album.name}</strong> · {album.visibility} · {album.assetCount} image(s)
                  </summary>
                  {album.sharedWith.length > 0 ? (
                    <p className="mt-1 text-[11px] text-ink-soft">Shared with {album.sharedWith.map((entry) => entry.name).join(", ")}</p>
                  ) : null}
                  {album.owner_member_id === actor.id ? (
                    <>
                      <form action={shareAlbumAction} className="mt-2 space-y-1">
                        <input type="hidden" name="albumId" value={album.id} />
                        <input type="hidden" name="redirectTo" value="/studio" />
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
                        <input type="hidden" name="redirectTo" value="/studio" />
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
              <input type="hidden" name="library" value="studio" />
              <input type="hidden" name="redirectTo" value="/studio" />
              <input name="name" required placeholder="New album name" className="field mt-0" />
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

          <Card title="Privacy & limits">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>🔐 Only you can see this library until you share an image or album.</li>
              <li>🖼️ Original uploads and edited results are stored as separate assets.</li>
              <li>📦 Quota: {Math.round(usage.quotaBytes / 1024 / 1024)} MB per member. Deleted files are purged after the retention window.</li>
              <li>🧾 Every image records owner, date, model, workflow and prompt.</li>
              <li>⏱️ Image jobs run one at a time so six family members cannot exhaust the Mac Studio.</li>
            </ul>
          </Card>
        </div>
      </div>

      <p className="mt-5 text-center text-[11px] text-ink-soft">
        Image results are served through authenticated <code>/api/media</code> routes. ComfyUI and Ollama ports are never exposed to the browser.
      </p>
    </>
  );
}
