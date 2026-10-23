import Link from "next/link";
import { all } from "@/lib/db";
import type { MemberRow } from "@/lib/db/rows";
import { can } from "@/lib/auth/actor";
import { requireActor } from "@/lib/auth/session";
import { replenishmentSuggestions } from "@/lib/domain/household";
import { listShoppingItems, listShoppingLists } from "@/lib/domain/shopping";
import {
  addShoppingItemAction,
  clearBoughtAction,
  createShoppingListAction,
  toggleShoppingItemAction,
} from "@/lib/actions";
import { Badge, Card, EmptyState, FeedbackBanner, PageHeader } from "@/components/ui";
import { GuestRestricted } from "@/components/ui";

export const metadata = { title: "Shopping" };

export default async function ShoppingPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; ok?: string; error?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  if (actor.role === "relative") {
    return (
      <>
        <PageHeader eyebrow="Shared lists" title="Shopping" />
        <GuestRestricted title="Shopping lists" />
      </>
    );
  }
  const lists = listShoppingLists(actor);
  const selectedList = lists.find((list) => list.id === params.list) ?? lists[0];
  const items = listShoppingItems(actor, { listId: selectedList?.id, includeBought: true });
  const openItems = items.filter((item) => item.status === "open");
  const boughtItems = items.filter((item) => item.status === "bought");
  const members = all<MemberRow>(
    "SELECT * FROM members WHERE household_id = ? AND deactivated_at IS NULL ORDER BY created_at",
    [actor.householdId],
  );
  const canShop = can(actor, "shopping.manage");
  let suggestions: ReturnType<typeof replenishmentSuggestions> = [];
  try {
    suggestions = replenishmentSuggestions(actor);
  } catch {
    suggestions = [];
  }

  return (
    <>
      <PageHeader
        eyebrow="Shared lists"
        title="Shopping"
        subtitle="One list per shop, shared in real time. Check items off as you go; bought items stay until you clear them."
        actions={
          <Link href="/household" className="btn-secondary">
            Inventory & meals →
          </Link>
        }
      />
      <FeedbackBanner ok={params.ok} error={params.error} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {lists.map((list) => (
          <Link
            key={list.id}
            href={`/shopping?list=${list.id}`}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              selectedList?.id === list.id ? "border-teal bg-teal text-white" : "border-black/10 bg-white text-ink-soft hover:border-teal/40"
            }`}
          >
            {list.name}
            <span className={`ml-2 text-[11px] ${selectedList?.id === list.id ? "text-white/70" : "text-ink-soft/70"}`}>
              {list.openCount}
            </span>
          </Link>
        ))}
        {canShop ? (
          <details className="relative">
            <summary className="cursor-pointer rounded-full border border-dashed border-black/15 px-4 py-2 text-sm text-ink-soft hover:border-teal/40">
              + New list
            </summary>
            <form action={createShoppingListAction} className="card absolute z-10 mt-2 w-64 space-y-2 p-3">
              <input type="hidden" name="redirectTo" value="/shopping" />
              <input name="name" required placeholder="List name" className="field mt-0" />
              <input name="store" placeholder="Shop (optional)" className="field mt-0" />
              <button type="submit" className="btn w-full py-1.5 text-xs">Create list</button>
            </form>
          </details>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title={selectedList?.name ?? "Shopping list"}
            subtitle={selectedList?.store ? `Preferred shop: ${selectedList.store}` : "No preferred shop"}
            action={
              boughtItems.length > 0 ? (
                <form action={clearBoughtAction}>
                  <input type="hidden" name="listId" value={selectedList!.id} />
                  <input type="hidden" name="redirectTo" value={`/shopping?list=${selectedList!.id}`} />
                  <button type="submit" className="btn-ghost text-xs">Clear bought</button>
                </form>
              ) : undefined
            }
          >
            {openItems.length === 0 ? (
              <EmptyState icon="🛒" title="Nothing on this list" description="Add the first item below, or ask the assistant: “Add milk and bread to the shopping list.”" />
            ) : (
              <ul className="space-y-2">
                {openItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 rounded-xl border border-black/5 bg-white p-3">
                    <form action={toggleShoppingItemAction}>
                      <input type="hidden" name="itemId" value={item.id} />
                      <input type="hidden" name="status" value="bought" />
                      <input type="hidden" name="redirectTo" value={`/shopping?list=${selectedList?.id ?? ""}`} />
                      <button
                        type="submit"
                        aria-label={`Mark ${item.name} as bought`}
                        className="flex h-6 w-6 items-center justify-center rounded-full border border-black/20 text-transparent transition hover:border-teal hover:bg-teal-mist hover:text-teal"
                      >
                        ✓
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">
                        {item.name}
                        {item.quantity ? <span className="ml-2 text-xs font-normal text-ink-soft">{item.quantity}</span> : null}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
                        {item.category ? <span>{item.category}</span> : null}
                        {item.assigneeName ? <span>· {item.assigneeName}</span> : null}
                        {item.estimated_price ? <span>· ≈ {item.estimated_price.toFixed(2)}</span> : null}
                      </div>
                    </div>
                    <Badge tone={item.priority === "urgent" ? "red" : item.priority === "high" ? "amber" : "neutral"}>{item.priority}</Badge>
                  </li>
                ))}
              </ul>
            )}

            {boughtItems.length > 0 ? (
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-soft">Bought · {boughtItems.length}</p>
                <ul className="space-y-1.5">
                  {boughtItems.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 rounded-lg bg-sand/40 px-3 py-1.5 text-sm text-ink-soft">
                      <form action={toggleShoppingItemAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="status" value="open" />
                        <input type="hidden" name="redirectTo" value={`/shopping?list=${selectedList?.id ?? ""}`} />
                        <button type="submit" aria-label={`Move ${item.name} back`} className="text-teal hover:underline">
                          ↺
                        </button>
                      </form>
                      <span className="line-through">{item.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {canShop ? (
            <Card title="Add an item" subtitle="Duplicates are merged into the existing item.">
              <form action={addShoppingItemAction} className="grid gap-3 sm:grid-cols-[1.5fr_0.8fr_0.8fr_auto]">
                <input type="hidden" name="listId" value={selectedList?.id ?? ""} />
                <input type="hidden" name="redirectTo" value={`/shopping?list=${selectedList?.id ?? ""}`} />
                <div>
                  <label className="label" htmlFor="item-name">Item</label>
                  <input id="item-name" name="name" required className="field" placeholder="Milk" />
                </div>
                <div>
                  <label className="label" htmlFor="item-quantity">Quantity</label>
                  <input id="item-quantity" name="quantity" className="field" placeholder="2 l" />
                </div>
                <div>
                  <label className="label" htmlFor="item-priority">Priority</label>
                  <select id="item-priority" name="priority" className="field" defaultValue="normal">
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button type="submit" className="btn w-full">Add</button>
                </div>
                <div className="sm:col-span-4">
                  <label className="label" htmlFor="item-assignee">Assign to</label>
                  <select id="item-assignee" name="assignedMemberId" className="field" defaultValue="">
                    <option value="">Anyone</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </select>
                </div>
              </form>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card title="Running low" subtitle="Based on recorded stock and minimum thresholds — not a sensor.">
            {suggestions.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing is below its minimum level.</p>
            ) : (
              <ul className="space-y-2">
                {suggestions.map(({ item, suggestedQuantity }) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <div>
                      <p className="text-sm font-medium text-amber-950">{item.name}</p>
                      <p className="text-[11px] text-amber-900/80">
                        {item.quantity} {item.unit ?? ""} left · minimum {item.min_stock}
                      </p>
                    </div>
                    {canShop ? (
                      <form action={addShoppingItemAction}>
                        <input type="hidden" name="name" value={item.name} />
                        <input type="hidden" name="quantity" value={`${suggestedQuantity} ${item.unit ?? ""}`.trim()} />
                        <input type="hidden" name="priority" value="high" />
                        <input type="hidden" name="redirectTo" value={`/shopping?list=${selectedList?.id ?? ""}`} />
                        <button type="submit" className="btn-secondary px-3 py-1 text-xs">Add</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="How lists work" subtitle="Small rules that avoid surprises">
            <ul className="space-y-2 text-xs text-ink-soft">
              <li>🧾 Items are shared with the whole household; lists can be split per shop.</li>
              <li>🔁 Adding an item that is already open updates its quantity instead of duplicating it.</li>
              <li>✅ Checking an item never deletes it; “Clear bought” removes them for good.</li>
              <li>👶 Children can add and check items but cannot manage non-shopping data.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
