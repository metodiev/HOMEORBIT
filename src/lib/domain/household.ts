import { all, get, run } from "@/lib/db";
import type { InventoryRow, MealPlanRow, MemberRow, RecipeRow, ShoppingItemRow } from "@/lib/db/rows";
import { can, type Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, nowIso, parseJson, toJson } from "@/lib/util/ids";
import { addDaysToDateString } from "@/lib/util/dates";
import { addShoppingItem } from "./shopping";
import { recordAudit } from "./audit";

export type Ingredient = { name: string; quantity?: string; unit?: string };

export type RecipeView = RecipeRow & { ingredients: Ingredient[] };

function recipeView(row: RecipeRow): RecipeView {
  return { ...row, ingredients: parseJson<Ingredient[]>(row.ingredients_json, []) };
}

export function listRecipes(actor: Actor): RecipeView[] {
  if (actor.role === "relative") return [];
  return all<RecipeRow>("SELECT * FROM recipes WHERE household_id = ? ORDER BY title", [actor.householdId]).map(
    recipeView,
  );
}

export function createRecipe(
  actor: Actor,
  input: { title: string; ingredients: Ingredient[]; instructions?: string; tags?: string; servings?: number },
): RecipeView {
  if (!can(actor, "meal.manage")) throw new ForbiddenError("Your role cannot manage recipes.");
  const title = input.title.trim();
  if (!title) throw new ValidationError("A recipe needs a title.");
  if (!Array.isArray(input.ingredients) || input.ingredients.length === 0) {
    throw new ValidationError("Add at least one ingredient.");
  }
  const id = newId("rcp");
  run(
    `INSERT INTO recipes (id, household_id, title, ingredients_json, instructions, tags, servings, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actor.householdId,
      title,
      toJson(input.ingredients.map((item) => ({ ...item, name: item.name.trim() })).filter((item) => item.name)),
      input.instructions ?? null,
      input.tags ?? null,
      input.servings ?? 4,
      actor.id,
      nowIso(),
    ],
  );
  recordAudit(actor, "recipe.created", "recipe", id, { title });
  return recipeView(get<RecipeRow>("SELECT * FROM recipes WHERE id = ?", [id]) as RecipeRow);
}

export type MealPlanView = MealPlanRow & { recipeTitle: string | null };

export function listMealPlan(actor: Actor, fromDate: string, toDate: string): MealPlanView[] {
  if (actor.role === "relative") return [];
  return all<MealPlanView>(
    `SELECT mp.*, r.title AS recipeTitle FROM meal_plan mp
     LEFT JOIN recipes r ON r.id = mp.recipe_id
     WHERE mp.household_id = ? AND mp.date >= ? AND mp.date <= ? ORDER BY mp.date, mp.meal_type`,
    [actor.householdId, fromDate, toDate],
  );
}

export function setMealPlanEntry(
  actor: Actor,
  input: { date: string; mealType: MealPlanRow["meal_type"]; title: string; recipeId?: string | null; notes?: string | null },
): MealPlanRow {
  if (!can(actor, "meal.manage")) throw new ForbiddenError("Your role cannot manage meals.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError("Use a valid date (YYYY-MM-DD).");
  const title = input.title.trim();
  if (!title) throw new ValidationError("A meal needs a title.");
  const existing = get<MealPlanRow>(
    "SELECT * FROM meal_plan WHERE household_id = ? AND date = ? AND meal_type = ?",
    [actor.householdId, input.date, input.mealType],
  );
  if (existing) {
    run("UPDATE meal_plan SET title = ?, recipe_id = ?, notes = ? WHERE id = ?", [
      title,
      input.recipeId ?? null,
      input.notes ?? null,
      existing.id,
    ]);
    recordAudit(actor, "meal.updated", "meal", existing.id);
    return get<MealPlanRow>("SELECT * FROM meal_plan WHERE id = ?", [existing.id]) as MealPlanRow;
  }
  const id = newId("mel");
  run(
    `INSERT INTO meal_plan (id, household_id, date, meal_type, title, recipe_id, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actor.householdId,
      input.date,
      input.mealType,
      title,
      input.recipeId ?? null,
      input.notes ?? null,
      actor.id,
      nowIso(),
    ],
  );
  recordAudit(actor, "meal.created", "meal", id, { date: input.date, title });
  return get<MealPlanRow>("SELECT * FROM meal_plan WHERE id = ?", [id]) as MealPlanRow;
}

export function deleteMealPlanEntry(actor: Actor, mealId: string): void {
  if (!can(actor, "meal.manage")) throw new ForbiddenError("Your role cannot manage meals.");
  run("DELETE FROM meal_plan WHERE id = ? AND household_id = ?", [mealId, actor.householdId]);
  recordAudit(actor, "meal.deleted", "meal", mealId);
}

/** Deterministic 7-day draft plan chosen from stored recipes; the agent may present it for approval. */
export function generateMealPlanDraft(
  actor: Actor,
  input: { fromDate: string; days?: number; avoidTags?: string[] },
): { date: string; mealType: "dinner"; title: string; recipeId: string | null }[] {
  if (!can(actor, "meal.manage")) throw new ForbiddenError("Your role cannot plan meals.");
  const recipes = listRecipes(actor).filter(
    (recipe) => !(input.avoidTags ?? []).some((tag) => (recipe.tags ?? "").toLowerCase().includes(tag.toLowerCase())),
  );
  const days = Math.min(14, Math.max(1, input.days ?? 7));
  if (recipes.length === 0) return [];
  const draft: { date: string; mealType: "dinner"; title: string; recipeId: string | null }[] = [];
  for (let index = 0; index < days; index += 1) {
    const recipe = recipes[index % recipes.length];
    draft.push({
      date: addDaysToDateString(input.fromDate, index),
      mealType: "dinner",
      title: recipe.title,
      recipeId: recipe.id,
    });
  }
  return draft;
}

export function addMealPlanIngredientsToShoppingList(
  actor: Actor,
  input: { fromDate: string; toDate: string; listId?: string; scale?: number },
): { added: number; skipped: number; items: ShoppingItemRow[] } {
  if (!can(actor, "meal.manage")) throw new ForbiddenError("Your role cannot plan meals.");
  const entries = listMealPlan(actor, input.fromDate, input.toDate).filter((entry) => entry.recipe_id);
  const items: ShoppingItemRow[] = [];
  let skipped = 0;
  for (const entry of entries) {
    const recipe = get<RecipeRow>("SELECT * FROM recipes WHERE id = ? AND household_id = ?", [
      entry.recipe_id,
      actor.householdId,
    ]);
    if (!recipe) continue;
    for (const ingredient of parseJson<Ingredient[]>(recipe.ingredients_json, [])) {
      if (!ingredient.name) {
        skipped += 1;
        continue;
      }
      const quantity = [ingredient.quantity, ingredient.unit].filter(Boolean).join(" ") || undefined;
      items.push(
        addShoppingItem(actor, {
          listId: input.listId,
          name: ingredient.name,
          quantity,
          category: "groceries",
        }),
      );
    }
  }
  return { added: items.length, skipped, items };
}

export function listInventory(actor: Actor): InventoryRow[] {
  if (actor.role === "relative") return [];
  return all<InventoryRow>(
    "SELECT * FROM inventory_items WHERE household_id = ? ORDER BY name",
    [actor.householdId],
  );
}

export function upsertInventoryItem(
  actor: Actor,
  input: { id?: string; name: string; category?: string | null; quantity: number; unit?: string | null; minStock?: number | null },
): InventoryRow {
  if (!can(actor, "household.manage")) throw new ForbiddenError("Your role cannot manage inventory.");
  const name = input.name.trim();
  if (!name) throw new ValidationError("An inventory item needs a name.");
  if (input.quantity < 0) throw new ValidationError("Quantity cannot be negative.");
  if (input.id) {
    const existing = get<InventoryRow>(
      "SELECT * FROM inventory_items WHERE id = ? AND household_id = ?",
      [input.id, actor.householdId],
    );
    if (!existing) throw new NotFoundError("Inventory item not found.");
    run(
      "UPDATE inventory_items SET name = ?, category = ?, quantity = ?, unit = ?, min_stock = ?, updated_at = ? WHERE id = ?",
      [name, input.category ?? null, input.quantity, input.unit ?? null, input.minStock ?? null, nowIso(), existing.id],
    );
    return get<InventoryRow>("SELECT * FROM inventory_items WHERE id = ?", [existing.id]) as InventoryRow;
  }
  const id = newId("inv");
  run(
    `INSERT INTO inventory_items (id, household_id, name, category, quantity, unit, min_stock, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, actor.householdId, name, input.category ?? null, input.quantity, input.unit ?? null, input.minStock ?? null, nowIso()],
  );
  recordAudit(actor, "inventory.created", "inventory", id, { name });
  return get<InventoryRow>("SELECT * FROM inventory_items WHERE id = ?", [id]) as InventoryRow;
}

export function replenishmentSuggestions(
  actor: Actor,
): { item: InventoryRow; suggestedQuantity: number }[] {
  return listInventory(actor)
    .filter((item) => item.min_stock !== null && item.quantity <= item.min_stock)
    .map((item) => ({ item, suggestedQuantity: Math.max(1, Math.ceil((item.min_stock ?? 0) - item.quantity + 1)) }));
}

export function householdMembers(householdId: string): MemberRow[] {
  return all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [householdId],
  );
}
