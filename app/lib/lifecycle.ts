import type { Lifecycle, View } from "./types.ts";

// COD lifecycle derived from Shopify state. Mapping approved by Omar (docs/DECISIONS.md):
//   not cancelled + unfulfilled                 -> PLACED
//   fulfilled + financial PENDING               -> IN_TRANSIT
//   financial PAID                              -> DELIVERED (he flips PENDING -> PAID by hand)
//   cancelled/VOIDED and never fulfilled        -> CANCELLED
//   cancelled/VOIDED after being fulfilled      -> RETURNED (refused or returned)
//   REFUNDED / PARTIALLY_REFUNDED               -> same names

export interface LifecycleInput {
  cancelledAt: string | Date | null;
  financialStatus: string; // displayFinancialStatus: PENDING | PAID | VOIDED | REFUNDED ...
  fulfillmentStatus: string; // displayFulfillmentStatus: UNFULFILLED | FULFILLED ...
  fulfilledAt?: string | Date | null; // earliest successful fulfillment, if known
}

const FULFILLED_STATUSES = new Set(["FULFILLED", "PARTIALLY_FULFILLED"]);

export function wasFulfilled(i: LifecycleInput): boolean {
  return FULFILLED_STATUSES.has(i.fulfillmentStatus.toUpperCase()) || Boolean(i.fulfilledAt);
}

export function deriveLifecycle(i: LifecycleInput): Lifecycle {
  const financial = i.financialStatus.toUpperCase();
  if (financial === "REFUNDED") return "REFUNDED";
  if (i.cancelledAt || financial === "VOIDED") {
    return wasFulfilled(i) ? "RETURNED" : "CANCELLED";
  }
  if (financial === "PARTIALLY_REFUNDED") return "PARTIALLY_REFUNDED";
  if (financial === "PAID") return "DELIVERED";
  if (wasFulfilled(i)) return "IN_TRANSIT";
  return "PLACED";
}

const REVERSED: ReadonlySet<Lifecycle> = new Set<Lifecycle>(["CANCELLED", "RETURNED", "REFUNDED"]);

// Orders that ended as lost revenue (partial refunds are not counted as reversed orders).
export function isReversed(l: Lifecycle): boolean {
  return REVERSED.has(l);
}

// Does an order with this lifecycle count in the given dashboard view?
//   gross: everything not reversed (placed, in transit, delivered, partially refunded)
//   net:   only delivered money (partially refunded orders count, minus their refund amount)
export function countsInView(l: Lifecycle, view: View): boolean {
  if (isReversed(l)) return false;
  if (view === "gross") return true;
  return l === "DELIVERED" || l === "PARTIALLY_REFUNDED";
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

// "Stale": shipped, still not marked PAID after staleDays. Prompts Omar to update the order.
export function isStale(
  lifecycle: Lifecycle,
  fulfilledAt: string | Date | null,
  now: Date,
  staleDays: number,
): boolean {
  if (lifecycle !== "IN_TRANSIT" || !fulfilledAt) return false;
  return now.getTime() - new Date(fulfilledAt).getTime() > staleDays * MS_PER_DAY;
}

// "Final": old enough that late reversals are unlikely (observed reversals arrive up to ~9+ days later).
// Orders still PLACED or IN_TRANSIT are never final, whatever their age.
export function isFinal(
  lifecycle: Lifecycle,
  createdAt: string | Date,
  now: Date,
  finalAfterDays: number,
): boolean {
  if (lifecycle === "PLACED" || lifecycle === "IN_TRANSIT") return false;
  return now.getTime() - new Date(createdAt).getTime() >= finalAfterDays * MS_PER_DAY;
}

export function hoursBetween(a: string | Date, b: string | Date): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / MS_PER_HOUR;
}
