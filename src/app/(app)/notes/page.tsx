import Link from "next/link";
import { all } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { can } from "@/lib/auth/actor";
import { requireActor } from "@/lib/auth/session";
import { intlLocale } from "@/lib/i18n";
import { formatDate } from "@/lib/util/dates";
import { listNotes, NOTE_CATEGORIES } from "@/lib/domain/notes";
import { createNoteAction, deleteNoteAction, shareNoteAction, updateNoteAction } from "@/lib/actions";
import { Badge, Card, EmptyState, FeedbackBanner, MemberAvatar, PageHeader } from "@/components/ui";

export const metadata = { title: "Notes & documents" };

export default async function NotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const locale = intlLocale(actor.locale);
  const notes = listNotes(actor, { search: params.q, category: params.category });
  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [actor.householdId],
  );
  const canShare = can(actor, "note.create_shared");

  return (
    <>
      <PageHeader
        eyebrow="Family knowledge"
        title="Notes & documents"
        subtitle="Wifi codes, appliance manuals, school information and emergency contacts — indexed, searchable and access-controlled."
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <form method="get" action="/notes" className="flex flex-1 gap-2 sm:flex-none">
          {params.category ? <input type="hidden" name="category" value={params.category} /> : null}
          <input name="q" defaultValue={params.q ?? ""} placeholder="Search notes…" className="field mt-0 sm:w-64" />
          <button type="submit" className="btn-secondary">Search</button>
        </form>
        <Link href="/notes" className={`rounded-full px-3 py-1.5 text-xs ${!params.category ? "bg-teal text-white" : "bg-white text-ink-soft"}`}>
          All
        </Link>
        {NOTE_CATEGORIES.map((category) => (
          <Link
            key={category}
            href={`/notes?category=${category}`}
            className={`rounded-full px-3 py-1.5 text-xs capitalize ${params.category === category ? "bg-teal text-white" : "bg-white text-ink-soft hover:text-ink"}`}
          >
            {category}
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {notes.length === 0 ? (
            <EmptyState icon="📝" title="No notes here yet" description="Save a household instruction, a warranty or an emergency contact." />
          ) : (
            notes.map((note) => (
              <Card key={note.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-ink">{note.title}</h2>
                      <Badge tone={note.visibility === "private" ? "neutral" : note.visibility === "restricted" ? "berry" : "blue"}>
                        {note.visibility}
                      </Badge>
                      <Badge tone="neutral">{note.category}</Badge>
                      {note.sensitive === 1 ? <Badge tone="red">🔒 sensitive</Badge> : null}
                    </div>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-ink-soft">
                      <MemberAvatar name={note.ownerName} color={note.ownerColor} size="sm" />
                      {note.ownerName} · updated {formatDate(note.updated_at, locale, actor.timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{note.body}</p>
                {note.sharedWith.length > 0 ? (
                  <p className="mt-2 text-[11px] text-ink-soft">Shared with: {note.sharedWith.map((entry) => entry.name).join(", ")}</p>
                ) : null}
                {note.owner_member_id === actor.id || can(actor, "note.create_shared") ? (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-ink-soft hover:text-teal">Manage note</summary>
                    <form action={updateNoteAction} className="mt-3 space-y-2">
                      <input type="hidden" name="noteId" value={note.id} />
                      <input type="hidden" name="redirectTo" value="/notes" />
                      <input name="title" defaultValue={note.title} className="field mt-0" />
                      <textarea name="body" rows={3} defaultValue={note.body} className="field mt-0" />
                      <div className="grid grid-cols-2 gap-2">
                        <select name="visibility" defaultValue={note.visibility} className="field mt-0">
                          <option value="household">Household</option>
                          <option value="private">Private</option>
                          <option value="restricted">Restricted</option>
                        </select>
                        <select name="category" defaultValue={note.category} className="field mt-0 capitalize">
                          {NOTE_CATEGORIES.map((category) => (
                            <option key={category} value={category}>{category}</option>
                          ))}
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-[11px]">
                        <input type="checkbox" name="sensitive" defaultChecked={note.sensitive === 1} /> Sensitive
                      </label>
                      <button type="submit" className="btn-secondary w-full py-1.5 text-xs">Save note</button>
                    </form>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <form action={shareNoteAction} className="flex items-end gap-1">
                        <input type="hidden" name="noteId" value={note.id} />
                        <input type="hidden" name="redirectTo" value="/notes" />
                        <select name="memberId" defaultValue="" className="rounded-full border border-black/10 bg-white px-2 py-1 text-[11px]">
                          <option value="">Share with…</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>{member.name}</option>
                          ))}
                        </select>
                        <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">Share</button>
                      </form>
                      <form action={deleteNoteAction}>
                        <input type="hidden" name="noteId" value={note.id} />
                        <input type="hidden" name="redirectTo" value="/notes" />
                        <button type="submit" className="btn-ghost px-2 py-1 text-[11px] text-red-700 hover:bg-red-50">Delete</button>
                      </form>
                    </div>
                  </details>
                ) : null}
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4">
          {canShare ? (
            <Card title="New note" subtitle="Choose who can see it. Sensitive notes require the right permission.">
              <form action={createNoteAction} className="space-y-3">
                <input type="hidden" name="redirectTo" value="/notes" />
                <div>
                  <label className="label" htmlFor="note-title">Title</label>
                  <input id="note-title" name="title" required className="field" placeholder="Spare house key" />
                </div>
                <div>
                  <label className="label" htmlFor="note-body">Content</label>
                  <textarea id="note-body" name="body" required rows={4} className="field" placeholder="The spare key is held by Grandma." />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label" htmlFor="note-visibility">Who can see it</label>
                    <select id="note-visibility" name="visibility" className="field" defaultValue="household">
                      <option value="household">Whole household</option>
                      <option value="private">Only me</option>
                      <option value="restricted">Selected people</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="note-category">Category</label>
                    <select id="note-category" name="category" className="field" defaultValue="general">
                      {NOTE_CATEGORIES.map((category) => (
                        <option key={category} value={category} className="capitalize">{category}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="label">Selected people</label>
                  <div className="mt-1 grid max-h-28 grid-cols-2 gap-1 overflow-y-auto rounded-xl border border-black/10 bg-white p-2 text-xs">
                    {members
                      .filter((member) => member.id !== actor.id)
                      .map((member) => (
                        <label key={member.id} className="flex items-center gap-2 px-1 py-0.5">
                          <input type="checkbox" name="sharedWith" value={member.id} />
                          <span>{member.name.split(" ")[0]}</span>
                        </label>
                      ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="sensitive" /> Contains codes, medical or financial details
                </label>
                <button type="submit" className="btn w-full">Save note</button>
              </form>
            </Card>
          ) : (
            <Card title="Private notes" subtitle="Your role can keep personal notes.">
              <form action={createNoteAction} className="space-y-3">
                <input type="hidden" name="redirectTo" value="/notes" />
                <input type="hidden" name="visibility" value="private" />
                <input name="title" required placeholder="Title" className="field mt-0" />
                <textarea name="body" required rows={4} placeholder="Content" className="field mt-0" />
                <button type="submit" className="btn w-full">Save private note</button>
              </form>
            </Card>
          )}

          <Card title="Sensitive by default" subtitle="Access rules">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>🔒 Codes, medical notes and financial details should be marked sensitive.</li>
              <li>👨‍👩‍👧 “Restricted” notes are visible only to the owner, chosen people, and adults with the sensitive-notes permission.</li>
              <li>🤖 The assistant can only surface notes you are allowed to read, and treats note text as untrusted data.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
