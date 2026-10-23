import { all, get, run } from "@/lib/db";
import type { MemberRow, NoteRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { canEditNote, canViewNote } from "@/lib/auth/access";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso, toJson } from "@/lib/util/ids";
import { recordAudit } from "./audit";

export const NOTE_CATEGORIES = [
  "general",
  "emergency",
  "appliance",
  "recipe",
  "school",
  "travel",
  "instruction",
  "link",
] as const;

export type NoteView = NoteRow & {
  ownerName: string;
  ownerColor: string;
  sharedWith: { memberId: string; name: string }[];
};

function toView(note: NoteRow): NoteView {
  const owner = get<MemberRow>("SELECT * FROM members WHERE id = ?", [note.owner_member_id]);
  const sharedWith = all<{ member_id: string; name: string }>(
    `SELECT ns.member_id, m.name FROM note_shares ns JOIN members m ON m.id = ns.member_id WHERE ns.note_id = ?`,
    [note.id],
  ).map((row) => ({ memberId: row.member_id, name: row.name }));
  return {
    ...note,
    ownerName: owner?.name ?? "Unknown",
    ownerColor: owner?.color ?? "#0f766e",
    sharedWith,
  };
}

export function listNotes(
  actor: Actor,
  options: { search?: string; category?: string; limit?: number } = {},
): NoteView[] {
  const params: unknown[] = [actor.householdId];
  let clause = "";
  if (options.category) {
    clause += " AND category = ?";
    params.push(options.category);
  }
  if (options.search) {
    clause += " AND (title LIKE ? OR body LIKE ?)";
    const term = `%${options.search}%`;
    params.push(term, term);
  }
  return all<NoteRow>(
    `SELECT * FROM notes WHERE household_id = ?${clause} ORDER BY updated_at DESC LIMIT 300`,
    params,
  )
    .filter((note) => canViewNote(actor, note))
    .slice(0, options.limit ?? 100)
    .map(toView);
}

export function getNote(actor: Actor, noteId: string): NoteView {
  const note = get<NoteRow>("SELECT * FROM notes WHERE id = ? AND household_id = ?", [
    noteId,
    actor.householdId,
  ]);
  if (!note || !canViewNote(actor, note)) throw new NotFoundError("Note not found.");
  return toView(note);
}

export type NoteInput = {
  title: string;
  body: string;
  visibility?: NoteRow["visibility"];
  category?: string;
  sensitive?: boolean;
  attachments?: { name: string; url: string }[];
  sharedWith?: string[];
};

export function createNote(actor: Actor, input: NoteInput): NoteView {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new ValidationError("A note needs a title.");
  if (!body) throw new ValidationError("A note needs some content.");
  const visibility = input.visibility ?? "household";
  if (visibility !== "private" && !can(actor, "note.create_shared")) {
    throw new ForbiddenError("Your role can only keep private notes.");
  }
  if (input.sensitive && !can(actor, "note.read_sensitive")) {
    throw new ForbiddenError("Your role cannot store sensitive household notes.");
  }
  const id = newId("not");
  run(
    `INSERT INTO notes (id, household_id, title, body, visibility, owner_member_id, category, sensitive,
      attachments_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actor.householdId,
      title,
      body,
      visibility,
      actor.id,
      input.category ?? "general",
      input.sensitive ? 1 : 0,
      toJson(input.attachments ?? []),
      nowIso(),
      nowIso(),
    ],
  );
  for (const memberId of input.sharedWith ?? []) {
    shareNote(actor, id, memberId);
  }
  recordAudit(actor, "note.created", "note", id, { title, visibility, sensitive: Boolean(input.sensitive) });
  return getNote(actor, id);
}

export function updateNote(actor: Actor, noteId: string, input: Partial<NoteInput>): NoteView {
  const note = get<NoteRow>("SELECT * FROM notes WHERE id = ? AND household_id = ?", [
    noteId,
    actor.householdId,
  ]);
  if (!note) throw new NotFoundError("Note not found.");
  if (!canEditNote(actor, note)) throw new ForbiddenError("You cannot change this note.");
  run(
    `UPDATE notes SET title = ?, body = ?, visibility = ?, category = ?, sensitive = ?, attachments_json = ?,
      updated_at = ? WHERE id = ?`,
    [
      input.title?.trim() || note.title,
      input.body?.trim() || note.body,
      input.visibility ?? note.visibility,
      input.category ?? note.category,
      input.sensitive !== undefined ? (input.sensitive ? 1 : 0) : note.sensitive,
      input.attachments !== undefined ? toJson(input.attachments) : note.attachments_json,
      nowIso(),
      note.id,
    ],
  );
  recordAudit(actor, "note.updated", "note", note.id);
  return getNote(actor, note.id);
}

export function deleteNote(actor: Actor, noteId: string): void {
  const note = get<NoteRow>("SELECT * FROM notes WHERE id = ? AND household_id = ?", [
    noteId,
    actor.householdId,
  ]);
  if (!note) throw new NotFoundError("Note not found.");
  if (!canEditNote(actor, note)) throw new ForbiddenError("You cannot delete this note.");
  run("DELETE FROM notes WHERE id = ?", [note.id]);
  recordAudit(actor, "note.deleted", "note", note.id);
}

export function shareNote(actor: Actor, noteId: string, memberId: string): void {
  const note = get<NoteRow>("SELECT * FROM notes WHERE id = ? AND household_id = ?", [
    noteId,
    actor.householdId,
  ]);
  if (!note) throw new NotFoundError("Note not found.");
  if (!canEditNote(actor, note)) throw new ForbiddenError("You cannot share this note.");
  const member = get<MemberRow>(
    "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
    [memberId, actor.householdId],
  );
  if (!member) throw new ValidationError("That family member does not exist.");
  run("INSERT OR IGNORE INTO note_shares (note_id, member_id) VALUES (?, ?)", [noteId, memberId]);
  recordAudit(actor, "note.shared", "note", noteId, { memberId });
}

export function unshareNote(actor: Actor, noteId: string, memberId: string): void {
  const note = get<NoteRow>("SELECT * FROM notes WHERE id = ? AND household_id = ?", [
    noteId,
    actor.householdId,
  ]);
  if (!note) throw new NotFoundError("Note not found.");
  if (!canEditNote(actor, note)) throw new ForbiddenError("You cannot change sharing.");
  run("DELETE FROM note_shares WHERE note_id = ? AND member_id = ?", [noteId, memberId]);
  recordAudit(actor, "note.unshared", "note", noteId, { memberId });
}

export function searchNotes(actor: Actor, query: string): NoteView[] {
  return listNotes(actor, { search: query.trim(), limit: 20 });
}
