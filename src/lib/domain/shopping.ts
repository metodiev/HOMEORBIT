import { all, get, run } from "@/lib/db";
import type { MemberRow, ShoppingItemRow, ShoppingListRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso } from "@/lib/util/ids";
import { notifyMember } from "./notifications";
import { recordAudit } from "./audit";

export type ShoppingListWithCounts = ShoppingListRow & { openCount: number; boughtCount: number };

export function listShoppingLists(actor: Actor): ShoppingListWithCounts[] {
  if (actor.role === "relative") return [];
  return all<ShoppingListRow & { openCount: number; boughtCount: number }>(
    `SELECT l.*,
      (SELECT COUNT(*) FROM shopping_items i WHERE i.list_id = l.id AND i.status = 'open') AS openCount,
      (SELECT COUNT(*) FROM shopping_items i WHERE i.list_id = l.id AND i.status = 'bought') AS boughtCount
     FROM shopping_lists l WHERE l.household_id = ? AND l.archived_at IS NULL
     ORDER BY l.created_at`,
    [actor.householdId],
  );
}

export function createShoppingList(
  actor: Actor,
  input: { name: string; store?: string | null },
): ShoppingListRow {
  if (!can(actor, "shopping.manage")) throw new ForbiddenError("Your role cannot manage shopping lists.");
  const name = input.name.trim();
  if (!name) throw new ValidationError("A list needs a name.");
  const id = newId("lst");
  run("INSERT INTO shopping_lists (id, household_id, name, store, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    id,
    actor.householdId,
    name,
    input.store ?? null,
    actor.id,
    nowIso(),
  ]);
  recordAudit(actor, "shopping_list.created", "shopping_list", id, { name });
  return get<ShoppingListRow>("SELECT * FROM shopping_lists WHERE id = ?", [id]) as ShoppingListRow;
}

export function getOrCreateDefaultList(actor: Actor): ShoppingListRow {
  const existing = get<ShoppingListRow>(
    "SELECT * FROM shopping_lists WHERE household_id = ? AND archived_at IS NULL ORDER BY created_at LIMIT 1",
    [actor.householdId],
  );
  if (existing) return existing;
  if (!can(actor, "shopping.manage")) throw new ForbiddenError("No shopping list is available to you.");
  return createShoppingList(actor, { name: "Groceries" });
}

export function getShoppingList(actor: Actor, listId: string): ShoppingListRow {
  if (actor.role === "relative") throw new ForbiddenError("Shopping lists are not available to guest accounts.");
  const list = get<ShoppingListRow>("SELECT * FROM shopping_lists WHERE id = ? AND household_id = ?", [
    listId,
    actor.householdId,
  ]);
  if (!list) throw new NotFoundError("Shopping list not found.");
  return list;
}

export type ShoppingItemView = ShoppingItemRow & { assigneeName: string | null; assigneeColor: string | null };

export function listShoppingItems(
  actor: Actor,
  options: { listId?: string; includeBought?: boolean } = {},
): ShoppingItemView[] {
  if (actor.role === "relative") return [];
  const params: unknown[] = [actor.householdId];
  let clause = "";
  if (options.listId) {
    clause = " AND i.list_id = ?";
    params.push(options.listId);
  }
  if (!options.includeBought) {
    clause += " AND i.status = 'open'";
  } else {
    clause += " AND i.status != 'removed'";
  }
  return all<ShoppingItemView>(
    `SELECT i.*, m.name AS assigneeName, m.color AS assigneeColor
     FROM shopping_items i LEFT JOIN members m ON m.id = i.assigned_member_id
     WHERE i.household_id = ?${clause}
     ORDER BY CASE i.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, i.created_at`,
    params,
  );
}

export type ShoppingItemInput = {
  listId?: string;
  name: string;
  quantity?: string | null;
  brand?: string | null;
  category?: string | null;
  priority?: ShoppingItemRow["priority"];
  estimatedPrice?: number | null;
  assignedMemberId?: string | null;
};

export function addShoppingItem(actor: Actor, input: ShoppingItemInput): ShoppingItemRow {
  if (!can(actor, "shopping.manage")) throw new ForbiddenError("Your role cannot add shopping items.");
  const name = input.name.trim();
  if (!name) throw new ValidationError("An item needs a name.");
  const list = input.listId ? getShoppingList(actor, input.listId) : getOrCreateDefaultList(actor);
  if (list.archived_at) throw new ValidationError("This list is archived.");
  if (input.assignedMemberId) {
    const member = get<MemberRow>(
      "SELECT * FROM members WHERE id = ? AND household_id = ? AND deactivated_at IS NULL",
      [input.assignedMemberId, actor.householdId],
    );
    if (!member) throw new ValidationError("The assignee is not part of this household.");
  }
  const duplicate = get<ShoppingItemRow>(
    "SELECT * FROM shopping_items WHERE list_id = ? AND status = 'open' AND lower(name) = lower(?)",
    [list.id, name],
  );
  if (duplicate) {
    run("UPDATE shopping_items SET quantity = COALESCE(?, quantity), priority = ?, updated_at = ? WHERE id = ?", [
      input.quantity ?? null,
      input.priority ?? duplicate.priority,
      nowIso(),
      duplicate.id,
    ]);
    return get<ShoppingItemRow>("SELECT * FROM shopping_items WHERE id = ?", [duplicate.id]) as ShoppingItemRow;
  }
  const id = newId("itm");
  run(
    `INSERT INTO shopping_items
      (id, household_id, list_id, name, quantity, brand, category, priority, estimated_price, assigned_member_id,
       status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    [
      id,
      actor.householdId,
      list.id,
      name,
      input.quantity ?? null,
      input.brand ?? null,
      input.category ?? null,
      input.priority ?? "normal",
      input.estimatedPrice ?? null,
      input.assignedMemberId ?? null,
      actor.id,
      nowIso(),
      nowIso(),
    ],
  );
  recordAudit(actor, "shopping_item.created", "shopping_item", id, { name, listId: list.id });
  if (input.assignedMemberId && input.assignedMemberId !== actor.id) {
    const assignee = get<MemberRow>("SELECT * FROM members WHERE id = ?", [input.assignedMemberId]);
    if (assignee) {
      notifyMember(assignee, {
        title: `Shopping: ${name}`,
        body: `${actor.name} added this to ${list.name} and assigned it to you.`,
        category: "shopping",
        dedupeKey: `shopping-assigned:${id}:${assignee.id}`,
        link: "/shopping",
      });
    }
  }
  return get<ShoppingItemRow>("SELECT * FROM shopping_items WHERE id = ?", [id]) as ShoppingItemRow;
}

function getItem(actor: Actor, itemId: string): ShoppingItemRow {
  const item = get<ShoppingItemRow>("SELECT * FROM shopping_items WHERE id = ? AND household_id = ?", [
    itemId,
    actor.householdId,
  ]);
  if (!item) throw new NotFoundError("Shopping item not found.");
  return item;
}

export function setShoppingItemStatus(actor: Actor, itemId: string, status: ShoppingItemRow["status"]): void {
  if (!can(actor, "shopping.manage")) throw new ForbiddenError("Your role cannot change shopping items.");
  const item = getItem(actor, itemId);
  run("UPDATE shopping_items SET status = ?, updated_at = ? WHERE id = ?", [status, nowIso(), item.id]);
  recordAudit(actor, `shopping_item.${status}`, "shopping_item", item.id, { name: item.name });
}

export function updateShoppingItem(
  actor: Actor,
  itemId: string,
  input: Partial<Omit<ShoppingItemInput, "listId">>,
): ShoppingItemRow {
  if (!can(actor, "shopping.manage")) throw new ForbiddenError("Your role cannot change shopping items.");
  const item = getItem(actor, itemId);
  run(
    `UPDATE shopping_items SET name = ?, quantity = ?, brand = ?, category = ?, priority = ?,
      estimated_price = ?, assigned_member_id = ?, updated_at = ? WHERE id = ?`,
    [
      input.name?.trim() || item.name,
      input.quantity !== undefined ? input.quantity : item.quantity,
      input.brand !== undefined ? input.brand : item.brand,
      input.category !== undefined ? input.category : item.category,
      input.priority ?? item.priority,
      input.estimatedPrice !== undefined ? input.estimatedPrice : item.estimated_price,
      input.assignedMemberId !== undefined ? input.assignedMemberId : item.assigned_member_id,
      nowIso(),
      item.id,
    ],
  );
  return get<ShoppingItemRow>("SELECT * FROM shopping_items WHERE id = ?", [item.id]) as ShoppingItemRow;
}

export function clearBoughtItems(actor: Actor, listId: string): number {
  if (!can(actor, "shopping.manage")) throw new ForbiddenError("Your role cannot change shopping lists.");
  const list = getShoppingList(actor, listId);
  const result = run("DELETE FROM shopping_items WHERE list_id = ? AND status = 'bought'", [list.id]);
  recordAudit(actor, "shopping_list.cleared", "shopping_list", list.id, { removed: result.changes });
  return result.changes;
}
