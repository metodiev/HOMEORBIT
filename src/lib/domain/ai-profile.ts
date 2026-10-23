import { all, get, run } from "@/lib/db";
import type { MemberRow, MemoryRow } from "@/lib/db/rows";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso, parseJson } from "@/lib/util/ids";
import { recordAudit } from "@/lib/domain/audit";

export type AiProviderPreference = "auto" | "ollama" | "openai" | "local";

export type AiProfileView = {
  memberId: string;
  name: string;
  avatar: string;
  color: string;
  persona: string;
  interests: string[];
  preferences: Record<string, unknown>;
  provider: AiProviderPreference;
  model: string | null;
  shareFamilyKnowledge: boolean;
};

function memberRow(actor: Actor): MemberRow {
  const member = get<MemberRow>("SELECT * FROM members WHERE id = ? AND household_id = ?", [
    actor.id,
    actor.householdId,
  ]);
  if (!member) throw new NotFoundError("Member not found.");
  return member;
}

export function getAiProfile(actor: Actor): AiProfileView {
  const member = memberRow(actor);
  return {
    memberId: member.id,
    name: member.name,
    avatar: member.avatar,
    color: member.color,
    persona: member.persona ?? "",
    interests: parseJson<string[]>(member.interests_json, []),
    preferences: parseJson<Record<string, unknown>>(member.ai_preferences_json, {}),
    provider: (member.ai_provider as AiProviderPreference) ?? "auto",
    model: member.ai_model,
    shareFamilyKnowledge: member.share_family_knowledge === 1,
  };
}

export function updateAiProfile(
  actor: Actor,
  input: {
    persona?: string;
    interests?: string[];
    preferences?: Record<string, unknown>;
    provider?: AiProviderPreference;
    model?: string | null;
    shareFamilyKnowledge?: boolean;
  },
): AiProfileView {
  const member = memberRow(actor);
  if (input.provider && !["auto", "ollama", "openai", "local"].includes(input.provider)) {
    throw new ValidationError("Unknown AI provider.");
  }
  if (input.persona !== undefined && input.persona.length > 4000) {
    throw new ValidationError("Persona is limited to 4000 characters.");
  }
  const interests = (input.interests ?? parseJson<string[]>(member.interests_json, []))
    .map((interest) => interest.trim())
    .filter(Boolean)
    .slice(0, 30);
  run(
    `UPDATE members SET persona = ?, interests_json = ?, ai_preferences_json = ?, ai_provider = ?, ai_model = ?,
      share_family_knowledge = ?, updated_at = ? WHERE id = ?`,
    [
      input.persona !== undefined ? input.persona.slice(0, 4000) : member.persona,
      JSON.stringify(interests),
      JSON.stringify(input.preferences ?? parseJson<Record<string, unknown>>(member.ai_preferences_json, {})),
      input.provider ?? member.ai_provider,
      input.model !== undefined ? (input.model?.trim() || null) : member.ai_model,
      input.shareFamilyKnowledge !== undefined ? (input.shareFamilyKnowledge ? 1 : 0) : member.share_family_knowledge,
      nowIso(),
      member.id,
    ],
  );
  if (input.shareFamilyKnowledge === false) {
    run(
      "UPDATE member_memories SET scope = 'private', updated_at = ? WHERE member_id = ? AND scope = 'family'",
      [nowIso(), member.id],
    );
  }
  recordAudit(actor, "ai_profile.updated", "member", member.id, {
    provider: input.provider ?? member.ai_provider,
    shareFamilyKnowledge: input.shareFamilyKnowledge,
  });
  return getAiProfile(actor);
}

export type MemoryView = MemoryRow & { ownerName: string; ownerAvatar: string; ownerColor: string; tags: string[] };

function memoryView(row: MemoryRow): MemoryView {
  const owner = get<MemberRow>("SELECT * FROM members WHERE id = ?", [row.member_id]);
  return {
    ...row,
    ownerName: owner?.name ?? "Unknown",
    ownerAvatar: owner?.avatar ?? "👤",
    ownerColor: owner?.color ?? "#64748b",
    tags: parseJson<string[]>(row.tags_json, []),
  };
}

export function listMemories(
  actor: Actor,
  options: { scope?: "private" | "family" | "all"; search?: string; limit?: number } = {},
): MemoryView[] {
  const scope = options.scope ?? "all";
  const search = options.search?.trim();
  const params: unknown[] = [actor.householdId];
  const consentedFamily =
    "scope = 'family' AND member_id IN (SELECT id FROM members WHERE household_id = ? AND share_family_knowledge = 1)";
  let scopeClause: string;
  if (scope === "family") {
    if (actor.role === "relative") return [];
    scopeClause = consentedFamily;
    params.push(actor.householdId);
  } else if (scope === "private") {
    scopeClause = "(scope = 'private' AND member_id = ?)";
    params.push(actor.id);
  } else if (actor.role === "relative") {
    scopeClause = "(scope = 'private' AND member_id = ?)";
    params.push(actor.id);
  } else {
    scopeClause = `((${consentedFamily}) OR (scope = 'private' AND member_id = ?))`;
    params.push(actor.householdId, actor.id);
  }
  let searchClause = "";
  if (search) {
    searchClause = " AND (content LIKE ? OR tags_json LIKE ? OR category LIKE ?)";
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  params.push(Math.min(options.limit ?? 200, 500));
  return all<MemoryRow>(
    `SELECT * FROM member_memories WHERE household_id = ? AND (${scopeClause})${searchClause}
     ORDER BY updated_at DESC LIMIT ?`,
    params,
  )
    .filter((row) => (row.scope === "private" ? row.member_id === actor.id : actor.role !== "relative"))
    .map(memoryView);
}

export function createMemory(
  actor: Actor,
  input: { content: string; scope?: "private" | "family"; category?: string; tags?: string[] },
): MemoryView {
  const content = input.content.trim();
  if (!content) throw new ValidationError("A memory needs some content.");
  if (content.length > 4000) throw new ValidationError("Memories are limited to 4000 characters.");
  const scope = input.scope ?? "private";
  const member = memberRow(actor);
  if (scope === "family") {
    if (member.share_family_knowledge !== 1) {
      throw new ForbiddenError("Enable shared family knowledge in your AI profile before saving a family memory.");
    }
    if (actor.role === "relative") throw new ForbiddenError("Guest accounts cannot add family knowledge.");
  }
  const id = newId("mem");
  run(
    `INSERT INTO member_memories (id, household_id, member_id, scope, category, content, tags_json, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'explicit', ?, ?)`,
    [
      id,
      actor.householdId,
      actor.id,
      scope,
      input.category?.trim() || "general",
      content,
      JSON.stringify((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 20)),
      nowIso(),
      nowIso(),
    ],
  );
  recordAudit(actor, "memory.created", "memory", id, { scope });
  return memoryView(get<MemoryRow>("SELECT * FROM member_memories WHERE id = ?", [id]) as MemoryRow);
}

export function updateMemory(
  actor: Actor,
  memoryId: string,
  input: { content?: string; category?: string; tags?: string[]; scope?: "private" | "family" },
): MemoryView {
  const memory = get<MemoryRow>("SELECT * FROM member_memories WHERE id = ? AND household_id = ?", [
    memoryId,
    actor.householdId,
  ]);
  if (!memory) throw new NotFoundError("Memory not found.");
  if (memory.member_id !== actor.id) throw new ForbiddenError("You can only edit your own memories.");
  const member = memberRow(actor);
  if (input.scope === "family") {
    if (member.share_family_knowledge !== 1) {
      throw new ForbiddenError("Enable shared family knowledge before making a memory shared.");
    }
    if (actor.role === "relative") throw new ForbiddenError("Guest accounts cannot share family knowledge.");
  }
  run(
    "UPDATE member_memories SET content = ?, category = ?, tags_json = ?, scope = ?, updated_at = ? WHERE id = ?",
    [
      input.content?.trim() || memory.content,
      input.category?.trim() || memory.category,
      input.tags !== undefined ? JSON.stringify(input.tags.slice(0, 20)) : memory.tags_json,
      input.scope ?? memory.scope,
      nowIso(),
      memory.id,
    ],
  );
  recordAudit(actor, "memory.updated", "memory", memory.id);
  return memoryView(get<MemoryRow>("SELECT * FROM member_memories WHERE id = ?", [memory.id]) as MemoryRow);
}

export function deleteMemory(actor: Actor, memoryId: string): void {
  const memory = get<MemoryRow>("SELECT * FROM member_memories WHERE id = ? AND household_id = ?", [
    memoryId,
    actor.householdId,
  ]);
  if (!memory) throw new NotFoundError("Memory not found.");
  if (memory.member_id !== actor.id) throw new ForbiddenError("You can only delete your own memories.");
  run("DELETE FROM member_memories WHERE id = ?", [memory.id]);
  recordAudit(actor, "memory.deleted", "memory", memory.id);
}

/** Retrieves a small, relevant memory context for the assistant. */
export function memoryContext(actor: Actor, query: string, limit = 10): MemoryView[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 3)
    .slice(0, 6);
  const candidates = listMemories(actor, { scope: "all", limit: 80 });
  const scored = candidates.map((memory) => {
    const haystack = `${memory.content} ${memory.tags.join(" ")} ${memory.category}`.toLowerCase();
    let score = 0;
    for (const word of words) if (haystack.includes(word)) score += 2;
    if (memory.scope === "family") score += 0.5;
    return { memory, score };
  });
  scored.sort((a, b) => b.score - a.score || b.memory.updated_at.localeCompare(a.memory.updated_at));
  return scored.slice(0, limit).map((entry) => entry.memory);
}

export function familyKnowledge(actor: Actor, search?: string): MemoryView[] {
  return listMemories(actor, { scope: "family", search, limit: 300 });
}
