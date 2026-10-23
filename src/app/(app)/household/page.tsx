import Link from "next/link";
import { all } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { can } from "@/lib/auth/actor";
import { requireActor } from "@/lib/auth/session";
import { intlLocale } from "@/lib/i18n";
import { addDaysToDateString, dateStringInZone, formatDate, formatDateTime } from "@/lib/util/dates";
import { listMealPlan, listRecipes, listInventory } from "@/lib/domain/household";
import { listCalls } from "@/lib/domain/calls";
import {
  addMealIngredientsAction,
  createCallAction,
  createRecipeAction,
  setCallStatusAction,
  setMealAction,
  upsertInventoryAction,
} from "@/lib/actions";
import { Badge, Card, FeedbackBanner, MemberAvatar, PageHeader } from "@/components/ui";
import { GuestRestricted } from "@/components/ui";

export const metadata = { title: "Household" };

export default async function HouseholdPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  if (actor.role === "relative") {
    return (
      <>
        <PageHeader eyebrow="Home operations" title="Household" />
        <GuestRestricted title="Household operations" />
      </>
    );
  }
  const locale = intlLocale(actor.locale);
  const today = dateStringInZone(new Date(), actor.timezone);
  const end = addDaysToDateString(today, 6);
  const meals = listMealPlan(actor, today, end);
  const recipes = listRecipes(actor);
  const inventory = listInventory(actor);
  const lowStock = inventory.filter((item) => item.min_stock !== null && item.quantity <= item.min_stock);
  const calls = listCalls(actor, { includeDone: true });
  const openCalls = calls.filter((call) => call.status === "pending" || call.status === "postponed");
  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [actor.householdId],
  );
  const days = Array.from({ length: 7 }, (_, index) => addDaysToDateString(today, index));
  const canMeal = can(actor, "meal.manage");
  const canCall = can(actor, "call.manage");

  return (
    <>
      <PageHeader
        eyebrow="Home operations"
        title="Household"
        subtitle="Meals, recipes, stock levels and the call tracker — the quiet machinery that keeps a family running."
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="mb-5 flex flex-wrap gap-2 text-xs">
        <Link href="#meals" className="chip">🍲 Meal plan</Link>
        <Link href="#recipes" className="chip">📖 Recipes</Link>
        <Link href="#inventory" className="chip">📦 Inventory {lowStock.length > 0 ? `· ${lowStock.length} low` : ""}</Link>
        <Link href="#calls" className="chip">📞 Calls {openCalls.length > 0 ? `· ${openCalls.length} open` : ""}</Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="This week's dinners" subtitle="Plan meals; add the ingredients to the shopping list in one go.">
            <div id="meals" className="grid gap-2 sm:grid-cols-2">
              {days.map((day) => {
                const dayMeals = meals.filter((meal) => meal.date === day);
                return (
                  <div key={day} className={`rounded-xl border p-3 ${day === today ? "border-teal/40 bg-teal-mist/40" : "border-black/5 bg-white"}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                      {formatDate(day, locale, actor.timezone, { weekday: "short", day: "numeric", month: "short" })}
                    </p>
                    {dayMeals.length === 0 ? (
                      <p className="mt-1 text-xs text-ink-soft">No meals planned</p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {dayMeals.map((meal) => (
                          <li key={meal.id} className="text-xs">
                            <span className="font-medium capitalize text-ink">{meal.meal_type}:</span> {meal.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
            {canMeal ? (
              <div className="mt-4 grid gap-3 border-t border-black/5 pt-4">
                <form action={setMealAction} className="grid gap-2 sm:grid-cols-4">
                  <input type="hidden" name="redirectTo" value="/household" />
                  <div>
                    <label className="label" htmlFor="meal-date">Day</label>
                    <input id="meal-date" type="date" name="date" defaultValue={today} className="field" />
                  </div>
                  <div>
                    <label className="label" htmlFor="meal-type">Meal</label>
                    <select id="meal-type" name="mealType" className="field" defaultValue="dinner">
                      <option value="breakfast">Breakfast</option>
                      <option value="lunch">Lunch</option>
                      <option value="dinner">Dinner</option>
                      <option value="snack">Snack</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor="meal-title">What</label>
                    <input id="meal-title" name="title" required className="field" placeholder="Musaka" />
                  </div>
                  <div className="flex items-end">
                    <button type="submit" className="btn w-full">Plan meal</button>
                  </div>
                </form>
                <form action={addMealIngredientsAction} className="flex flex-wrap items-end gap-2 rounded-xl bg-sand/50 p-3">
                  <input type="hidden" name="fromDate" value={today} />
                  <input type="hidden" name="toDate" value={end} />
                  <input type="hidden" name="redirectTo" value="/household" />
                  <p className="flex-1 text-xs text-ink-soft">
                    Add every ingredient from this week&apos;s planned recipes to the shopping list.
                  </p>
                  <button type="submit" className="btn-secondary text-xs">Add ingredients to shopping</button>
                </form>
              </div>
            ) : null}
          </Card>

          <Card title="Recipes" subtitle="Stored once, reused for meal plans and shopping.">
            <div id="recipes" className="grid gap-3 sm:grid-cols-2">
              {recipes.map((recipe) => (
                <div key={recipe.id} className="rounded-xl border border-black/5 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{recipe.title}</p>
                    <Badge tone="neutral">serves {recipe.servings}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-soft">
                    {recipe.ingredients.map((ingredient) => `${ingredient.name}${ingredient.quantity ? ` (${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ""})` : ""}`).join(", ")}
                  </p>
                  {recipe.tags ? <p className="mt-1 text-[10px] uppercase tracking-wide text-ink-soft/70">{recipe.tags}</p> : null}
                </div>
              ))}
              {recipes.length === 0 ? <p className="text-sm text-ink-soft">No recipes stored yet.</p> : null}
            </div>
            {canMeal ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-ink">Add a recipe</summary>
                <form action={createRecipeAction} className="mt-3 space-y-2">
                  <input type="hidden" name="redirectTo" value="/household" />
                  <input name="title" required placeholder="Recipe title" className="field mt-0" />
                  <textarea name="ingredients" rows={3} required placeholder={"One ingredient per line, e.g.\nPotatoes | 1 | kg\nMinced meat | 500 | g"} className="field mt-0 font-mono text-xs" />
                  <textarea name="instructions" rows={2} placeholder="Instructions" className="field mt-0" />
                  <div className="grid grid-cols-3 gap-2">
                    <input name="tags" placeholder="Tags" className="field mt-0" />
                    <input name="servings" type="number" min="1" defaultValue="4" className="field mt-0" />
                    <button type="submit" className="btn">Save</button>
                  </div>
                </form>
              </details>
            ) : null}
          </Card>

          <Card title="Call tracker" subtitle="Missed calls, callbacks and who promised to follow up.">
            <div id="calls" className="space-y-2">
              {calls.length === 0 ? (
                <p className="text-sm text-ink-soft">No calls recorded.</p>
              ) : (
                calls.map((call) => (
                  <div key={call.id} className={`rounded-xl border p-3 ${call.status === "completed" ? "border-black/5 bg-sand/30" : "border-black/5 bg-white"}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className={`text-sm font-medium ${call.status === "completed" ? "text-ink-soft line-through" : "text-ink"}`}>
                          {call.contact_name}
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-soft">{call.direction}</span>
                        </p>
                        <p className="text-[11px] text-ink-soft">
                          {call.reason ?? "No reason recorded"}
                          {call.callback_at ? ` · callback ${formatDateTime(call.callback_at, locale, actor.timezone)}` : ""}
                          {call.assigneeName ? ` · ${call.assigneeName}` : ""}
                        </p>
                      </div>
                      <Badge tone={call.status === "completed" ? "teal" : call.status === "cancelled" ? "red" : "amber"}>{call.status}</Badge>
                    </div>
                    {call.status !== "completed" && call.status !== "cancelled" ? (
                      <div className="mt-2 flex gap-2">
                        <form action={setCallStatusAction}>
                          <input type="hidden" name="callId" value={call.id} />
                          <input type="hidden" name="status" value="completed" />
                          <input type="hidden" name="redirectTo" value="/household#calls" />
                          <button type="submit" className="btn-secondary px-2 py-1 text-[11px]">Done</button>
                        </form>
                        <form action={setCallStatusAction}>
                          <input type="hidden" name="callId" value={call.id} />
                          <input type="hidden" name="status" value="postponed" />
                          <input type="hidden" name="redirectTo" value="/household#calls" />
                          <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">Postpone</button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            {canCall ? (
              <form action={createCallAction} className="mt-4 grid gap-2 border-t border-black/5 pt-3 sm:grid-cols-4">
                <input type="hidden" name="redirectTo" value="/household#calls" />
                <input name="contactName" required placeholder="Who called?" className="field mt-0" />
                <select name="direction" className="field mt-0" defaultValue="missed">
                  <option value="missed">Missed</option>
                  <option value="incoming">Incoming</option>
                  <option value="outgoing">Outgoing</option>
                </select>
                <input name="reason" placeholder="Reason" className="field mt-0" />
                <button type="submit" className="btn">Record call</button>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="call-callback">Callback</label>
                  <input id="call-callback" type="datetime-local" name="callbackAt" className="field" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="call-assignee">Assign to</label>
                  <select id="call-assignee" name="assignedMemberId" className="field" defaultValue={actor.id}>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </select>
                </div>
              </form>
            ) : null}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Household inventory" subtitle="Recorded stock, not sensor data.">
            <div id="inventory" className="space-y-2">
              {inventory.map((item) => {
                const low = item.min_stock !== null && item.quantity <= item.min_stock;
                return (
                  <div key={item.id} className={`rounded-xl border p-2.5 ${low ? "border-amber-200 bg-amber-50" : "border-black/5 bg-white"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-ink">{item.name}</p>
                        <p className="text-[11px] text-ink-soft">
                          {item.quantity} {item.unit ?? ""}
                          {item.min_stock !== null ? ` · min ${item.min_stock}` : ""}
                        </p>
                      </div>
                      {low ? <Badge tone="amber">low</Badge> : null}
                    </div>
                    <form action={upsertInventoryAction} className="mt-2 flex items-end gap-1">
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="name" value={item.name} />
                      <input type="hidden" name="unit" value={item.unit ?? ""} />
                      <input type="hidden" name="minStock" value={item.min_stock ?? ""} />
                      <input type="hidden" name="category" value={item.category ?? ""} />
                      <input type="hidden" name="redirectTo" value="/household#inventory" />
                      <input name="quantity" type="number" min="0" step="0.5" defaultValue={item.quantity} className="w-20 rounded-full border border-black/10 px-2 py-1 text-xs" />
                      <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">Update</button>
                    </form>
                  </div>
                );
              })}
              {inventory.length === 0 ? <p className="text-sm text-ink-soft">No inventory recorded.</p> : null}
            </div>
            {can(actor, "household.manage") ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium">Add stock item</summary>
                <form action={upsertInventoryAction} className="mt-2 space-y-2">
                  <input type="hidden" name="redirectTo" value="/household#inventory" />
                  <input name="name" required placeholder="Dishwasher tablets" className="field mt-0" />
                  <div className="grid grid-cols-3 gap-2">
                    <input name="quantity" type="number" min="0" step="0.5" defaultValue="1" className="field mt-0" />
                    <input name="unit" placeholder="pack" className="field mt-0" />
                    <input name="minStock" type="number" min="0" step="0.5" placeholder="min" className="field mt-0" />
                  </div>
                  <input name="category" placeholder="Category" className="field mt-0" />
                  <button type="submit" className="btn w-full py-1.5 text-xs">Save</button>
                </form>
              </details>
            ) : null}
          </Card>

          <Card title="Open calls" subtitle="Promised follow-ups">
            {openCalls.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing pending.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {openCalls.map((call) => (
                  <li key={call.id} className="flex items-center justify-between gap-2">
                    <span className="text-ink">{call.contact_name}</span>
                    <span className="text-ink-soft">{call.assigneeName ?? "Unassigned"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Smart but honest" subtitle="How meal and stock suggestions work">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>🍽️ Meal plans come from recipes you stored, prioritising variety.</li>
              <li>🛒 Ingredient lists are generated only from planned recipes.</li>
              <li>📉 Low-stock alerts use recorded quantities and thresholds — never guessed.</li>
              <li>💳 HomeOrbit never pays bills or buys anything without an explicit, approved action.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
