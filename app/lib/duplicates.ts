import type { Lifecycle } from "./types.ts";
import { hoursBetween } from "./lifecycle.ts";

// 1) Possible duplicate orders: same customer (phone hash) ordering again within a short window.
//    Observed on real data: the same person submitting twice 3 minutes apart, and the same phone
//    re-ordering days later after the first order was voided. These are FLAGGED ONLY: a real
//    re-order is legitimate, and nothing is ever deleted or excluded automatically.
// 2) Fake-order suggestions: a quantity/ticket outlier, especially if it was cancelled quickly.
//    Suggestion only; Omar decides (Order.excluded).

export interface DupOrder {
  id: string;
  createdAt: string | Date;
  phoneHash: string | null;
  excluded?: boolean;
}

// Returns Map<laterOrderId, earlierOrderId>. Orders without a phone hash are ignored.
// Each later order points to the closest earlier non-excluded order inside the window.
export function findPossibleDuplicates(
  orders: DupOrder[],
  windowHours: number,
): Map<string, string> {
  const byPhone = new Map<string, DupOrder[]>();
  for (const o of orders) {
    if (!o.phoneHash) continue;
    const list = byPhone.get(o.phoneHash) ?? [];
    list.push(o);
    byPhone.set(o.phoneHash, list);
  }

  const result = new Map<string, string>();
  for (const list of byPhone.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (let i = 1; i < list.length; i++) {
      for (let j = i - 1; j >= 0; j--) {
        const earlier = list[j]!;
        if (earlier.excluded) continue;
        if (hoursBetween(earlier.createdAt, list[i]!.createdAt) <= windowHours) {
          result.set(list[i]!.id, earlier.id);
        }
        break; // closest earlier non-excluded order only
      }
    }
  }
  return result;
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface FakeCheckInput {
  quantity: number; // total units on the order
  totalPrice: number;
  lifecycle: Lifecycle;
  createdAt: string | Date;
  cancelledAt: string | Date | null;
}

export interface FakeCheckContext {
  medianTicket: number; // median order total of recent, non-reversed orders
  qtyThreshold: number;
  ticketMultiple: number;
  cancelWindowHours: number;
}

export interface FakeSuggestion {
  level: "none" | "review" | "likely";
  reasons: string[];
}

export function suggestFake(o: FakeCheckInput, ctx: FakeCheckContext): FakeSuggestion {
  const reasons: string[] = [];
  const bigQty = o.quantity >= ctx.qtyThreshold;
  const bigTicket = ctx.medianTicket > 0 && o.totalPrice >= ctx.ticketMultiple * ctx.medianTicket;
  if (bigQty) reasons.push(`quantity ${o.quantity} (threshold ${ctx.qtyThreshold})`);
  if (bigTicket) {
    reasons.push(
      `total ${o.totalPrice} is ${(o.totalPrice / ctx.medianTicket).toFixed(1)}x the median ticket ${ctx.medianTicket}`,
    );
  }
  if (!(bigQty && bigTicket)) {
    // Needs both signals; a single signal alone (e.g. a legitimate 5-unit order) is not enough.
    return { level: "none", reasons: [] };
  }
  const cancelledQuickly =
    o.cancelledAt != null && hoursBetween(o.createdAt, o.cancelledAt) <= ctx.cancelWindowHours;
  if (cancelledQuickly) {
    reasons.push(`cancelled ${hoursBetween(o.createdAt, o.cancelledAt!).toFixed(0)}h after being placed`);
    return { level: "likely", reasons };
  }
  return { level: "review", reasons };
}
