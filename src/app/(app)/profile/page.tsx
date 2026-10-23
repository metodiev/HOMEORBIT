import { requireActor } from "@/lib/auth/session";
import { t } from "@/lib/i18n";
import { getAiProfile, listMemories } from "@/lib/domain/ai-profile";
import { providerStatusFor } from "@/lib/agent/provider";
import { Badge, Card, EmptyState, FeedbackBanner, PageHeader } from "@/components/ui";
import { deleteMemoryAction, saveMemoryAction, updateAiProfileAction, updateMemoryAction } from "@/lib/actions";
import { ModelSelector } from "@/components/ModelSelector";

export const metadata = { title: "My AI" };

function preference(profile: Record<string, unknown>, key: string, fallback: string): string {
  const value = profile[key];
  return typeof value === "string" && value ? value : fallback;
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const profile = getAiProfile(actor);
  const status = providerStatusFor(actor);
  const memories = listMemories(actor, { scope: "all", limit: 300 });
  const own = memories.filter((memory) => memory.member_id === actor.id);
  const family = memories.filter((memory) => memory.member_id !== actor.id);

  return (
    <>
      <PageHeader eyebrow="Personal AI" title={t(actor.locale, "profile.title")} subtitle={t(actor.locale, "profile.subtitle")} />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <Card title="AI profile" subtitle="Only you can edit this profile. It shapes your assistant's tone and context.">
            <form action={updateAiProfileAction} className="space-y-4">
              <input type="hidden" name="redirectTo" value="/profile" />
              <div>
                <label className="label" htmlFor="persona">
                  Persona and instructions
                </label>
                <textarea
                  id="persona"
                  name="persona"
                  rows={5}
                  defaultValue={profile.persona}
                  placeholder="I prefer concise answers, practical suggestions and British spelling. Help me with photography and woodworking."
                  className="field"
                />
              </div>
              <div>
                <label className="label" htmlFor="interests">
                  Interests (one per line or comma separated)
                </label>
                <textarea
                  id="interests"
                  name="interests"
                  rows={3}
                  defaultValue={profile.interests.join("\n")}
                  placeholder="Film photography&#10;Hiking&#10;Bulgarian history"
                  className="field"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor="tone">
                    Tone
                  </label>
                  <select
                    id="tone"
                    name="tone"
                    defaultValue={preference(profile.preferences, "tone", "warm")}
                    className="field"
                  >
                    <option value="warm">Warm</option>
                    <option value="concise">Concise</option>
                    <option value="detailed">Detailed</option>
                    <option value="playful">Playful</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="detail">
                    Detail
                  </label>
                  <select
                    id="detail"
                    name="detail"
                    defaultValue={preference(profile.preferences, "detail", "balanced")}
                    className="field"
                  >
                    <option value="brief">Brief</option>
                    <option value="balanced">Balanced</option>
                    <option value="thorough">Thorough</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="humor">
                    Humour
                  </label>
                  <select
                    id="humor"
                    name="humor"
                    defaultValue={preference(profile.preferences, "humor", "light")}
                    className="field"
                  >
                    <option value="none">None</option>
                    <option value="light">Light</option>
                    <option value="dry">Dry</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="responseLanguage">
                    Answer language
                  </label>
                  <select
                    id="responseLanguage"
                    name="responseLanguage"
                    defaultValue={preference(profile.preferences, "language", actor.locale)}
                    className="field"
                  >
                    <option value="en">English</option>
                    <option value="bg">Български</option>
                    <option value="auto">Match the question</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="provider">
                    Model provider
                  </label>
                  <select id="provider" name="provider" defaultValue={profile.provider} className="field">
                    <option value="auto">Auto — local Ollama first</option>
                    <option value="ollama">Ollama (local only)</option>
                    <option value="openai">External OpenAI-compatible</option>
                    <option value="local">Built-in assistant only</option>
                  </select>
                </div>
              </div>
              <ModelSelector defaultValue={profile.model} />
              <label className="flex items-start gap-2 rounded-xl bg-sand/70 p-3 text-xs">
                <input type="checkbox" name="shareFamilyKnowledge" defaultChecked={profile.shareFamilyKnowledge} className="mt-0.5" />
                <span>
                  <strong>Opt in to the shared family knowledge base.</strong> You can save selected memories as family knowledge.
                  Guests never see family knowledge. Private memories stay private even when this is on. Turning this off
                  immediately converts your family-scoped memories back to private.
                </span>
              </label>
              <button type="submit" className="btn">
                Save AI profile
              </button>
            </form>
          </Card>

          <Card title="Long-term memories" subtitle="Review, edit or delete what the assistant is allowed to remember.">
            <div className="space-y-3">
              {own.length === 0 ? (
                <EmptyState icon="🧠" title="No memories yet" description="Save a preference below or tell the assistant “Remember that…”." />
              ) : (
                own.map((memory) => (
                  <article key={memory.id} className="rounded-2xl border border-black/5 bg-white/70 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={memory.scope === "family" ? "blue" : "teal"}>{memory.scope}</Badge>
                      <Badge tone="neutral">{memory.category}</Badge>
                      {memory.tags.map((tag) => (
                        <span key={tag} className="chip text-[10px]">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{memory.content}</p>
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-ink-soft hover:text-teal">Edit or delete</summary>
                      <form action={updateMemoryAction} className="mt-2 space-y-2">
                        <input type="hidden" name="memoryId" value={memory.id} />
                        <input type="hidden" name="redirectTo" value="/profile" />
                        <textarea name="content" rows={3} defaultValue={memory.content} className="field mt-0" />
                        <div className="grid grid-cols-2 gap-2">
                          <input name="category" defaultValue={memory.category} className="field mt-0" />
                          <input name="tags" defaultValue={memory.tags.join(", ")} className="field mt-0" />
                        </div>
                        <select name="scope" defaultValue={memory.scope} className="field mt-0">
                          <option value="private">Private</option>
                          <option value="family" disabled={!profile.shareFamilyKnowledge}>
                            Shared family knowledge
                          </option>
                        </select>
                        <div className="flex gap-2">
                          <button type="submit" className="btn-secondary flex-1 py-1 text-[11px]">
                            Save memory
                          </button>
                        </div>
                      </form>
                      <form action={deleteMemoryAction} className="mt-1">
                        <input type="hidden" name="memoryId" value={memory.id} />
                        <input type="hidden" name="redirectTo" value="/profile" />
                        <button type="submit" className="text-[11px] text-red-700 hover:underline">
                          Delete memory permanently
                        </button>
                      </form>
                    </details>
                  </article>
                ))
              )}
            </div>
          </Card>

          {family.length > 0 ? (
            <Card title="Shared family knowledge" subtitle="Added by other household members. Only the owner can edit these.">
              <div className="space-y-3">
                {family.map((memory) => (
                  <article key={memory.id} className="rounded-2xl border border-sky-100 bg-sky-50/60 p-3">
                    <p className="text-[11px] text-ink-soft">
                      {memory.ownerAvatar} {memory.ownerName} · {memory.category}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{memory.content}</p>
                  </article>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card title="Model status" subtitle={status.location === "local" ? "Local inference" : status.configured ? "External service" : "Built-in mode"}>
            <div className="space-y-2 text-xs text-ink-soft">
              <p>{status.note}</p>
              {status.configured ? (
                <>
                  <p>
                    Provider: <strong className="text-ink">{status.provider}</strong>
                  </p>
                  <p>
                    Model: <strong className="text-ink">{status.model}</strong>
                  </p>
                </>
              ) : null}
              <p>Vision model: {status.visionModelAvailable ? "configured" : "not configured"}</p>
              <p>Embedding model: {status.embeddingModelAvailable ? "configured" : "not configured"}</p>
              <p className="rounded-xl bg-sand/70 p-2 text-[11px]">
                Model downloads and inference happen on the Mac Studio. API keys are never sent to the browser.
              </p>
            </div>
          </Card>

          <Card title="Add a memory" subtitle="Explicit memories only — nothing is learned silently.">
            <form action={saveMemoryAction} className="space-y-2">
              <input type="hidden" name="redirectTo" value="/profile" />
              <textarea name="content" rows={4} required placeholder="I prefer films in Bulgarian with English subtitles." className="field mt-0" />
              <div className="grid grid-cols-2 gap-2">
                <input name="category" placeholder="Category" defaultValue="general" className="field mt-0" />
                <input name="tags" placeholder="tags, comma separated" className="field mt-0" />
              </div>
              <select name="scope" defaultValue="private" className="field mt-0">
                <option value="private">Private to me</option>
                <option value="family" disabled={!profile.shareFamilyKnowledge}>
                  Shared family knowledge
                </option>
              </select>
              {!profile.shareFamilyKnowledge ? (
                <p className="text-[11px] text-ink-soft">Enable shared family knowledge above to save family memories.</p>
              ) : null}
              <button type="submit" className="btn w-full">
                Save memory
              </button>
            </form>
          </Card>

          <Card title="Privacy boundaries">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>🔒 Private memories are stored per member and never appear in another member&apos;s context.</li>
              <li>👪 Family memories require your explicit opt-in and are hidden from invited relatives.</li>
              <li>🖼️ Private images stay in your library until you share them or add them to a family album.</li>
              <li>🧠 Vision descriptions never identify people or create biometric profiles.</li>
              <li>☁️ Web search, TMDB and external models are labelled in the assistant.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
