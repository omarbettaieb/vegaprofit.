import type { Lifecycle } from "./types.ts";

// Reconciliation (pure). Walks every order of a period and says where its money went:
//   placed     everything customers ordered (what Meta and the cart saw)
//   fake       orders you marked fake / test / spam
//   reversed   cancelled, voided, returned or refunded (including the refunded part of partial refunds)
//   open       placed or in transit: not delivered, not reversed yet
//   delivered  delivered orders (net of partial refunds)
// placed = fake + reversed + open + delivered, always.

export interface RecOrder {
  id: string;
  name: string;
  createdKey: string; // YYYY-MM-DD, shop timezone
  createdAt: Date;
  lifecycle: Lifecycle;
  excluded: boolean;
  totalPrice: number;
  totalRefunded: number;
  cancelledAt: Date | null;
}

export interface Bucket {
  orders: number;
  value: number;
}

export interface RecTotals {
  placed: Bucket;
  fake: Bucket;
  reversed: Bucket;
  open: Bucket;
  delivered: Bucket;
  real: Bucket; // open + delivered: money still expected to be real
}

const empty = (): Bucket => ({ orders: 0, value: 0 });
const REVERSED: Lifecycle[] = ["CANCELLED", "RETURNED", "REFUNDED"];

export function emptyTotals(): RecTotals {
  return { placed: empty(), fake: empty(), reversed: empty(), open: empty(), delivered: empty(), real: empty() };
}

export function addOrder(t: RecTotals, o: RecOrder): void {
  t.placed.orders += 1;
  t.placed.value += o.totalPrice;
  if (o.excluded) {
    t.fake.orders += 1;
    t.fake.value += o.totalPrice;
  } else if (REVERSED.includes(o.lifecycle)) {
    t.reversed.orders += 1;
    t.reversed.value += o.totalPrice;
  } else {
    const kept = o.totalPrice - o.totalRefunded;
    if (o.totalRefunded > 0) t.reversed.value += o.totalRefunded; // partial refund: money gone, order still stands
    if (o.lifecycle === "PLACED" || o.lifecycle === "IN_TRANSIT") {
      t.open.orders += 1;
      t.open.value += kept;
    } else {
      t.delivered.orders += 1;
      t.delivered.value += kept;
    }
  }
  t.real.orders = t.open.orders + t.delivered.orders;
  t.real.value = t.open.value + t.delivered.value;
}

export function reconcile(orders: RecOrder[]): RecTotals {
  const t = emptyTotals();
  for (const o of orders) addOrder(t, o);
  return t;
}

export interface Lag {
  count: number;
  medianDays: number | null;
  p85Days: number | null;
  maxDays: number | null;
}

// How long reversals take to arrive after the order was placed. Tells you how long to wait before trusting a day.
export function reversalLag(orders: RecOrder[]): Lag {
  const days = orders
    .filter((o) => !o.excluded && o.cancelledAt && REVERSED.includes(o.lifecycle))
    .map((o) => Math.max(0, (o.cancelledAt!.getTime() - o.createdAt.getTime()) / 86_400_000))
    .sort((a, b) => a - b);
  if (days.length === 0) return { count: 0, medianDays: null, p85Days: null, maxDays: null };
  const at = (p: number) => days[Math.min(days.length - 1, Math.floor(p * days.length))];
  const r = (n: number) => Math.round(n * 10) / 10;
  return { count: days.length, medianDays: r(at(0.5)), p85Days: r(at(0.85)), maxDays: r(days[days.length - 1]) };
}

// Orders that left the shop (or were placed) but never reached DELIVERED or a reversal within `staleDays`.
export function staleOrders(orders: RecOrder[], now: Date, staleDays: number): (RecOrder & { ageDays: number })[] {
  return orders
    .filter((o) => !o.excluded && (o.lifecycle === "PLACED" || o.lifecycle === "IN_TRANSIT"))
    .map((o) => ({ ...o, ageDays: Math.floor((now.getTime() - o.createdAt.getTime()) / 86_400_000) }))
    .filter((o) => o.ageDays >= staleDays)
    .sort((a, b) => b.ageDays - a.ageDays);
}

// Share of the period's value that is still too young to be final.
export function provisionalShare(orders: RecOrder[], now: Date, finalAfterDays: number): number | null {
  let total = 0;
  let young = 0;
  for (const o of orders) {
    if (o.excluded || REVERSED.includes(o.lifecycle)) continue;
    const v = o.totalPrice - o.totalRefunded;
    total += v;
    if ((now.getTime() - o.createdAt.getTime()) / 86_400_000 < finalAfterDays) young += v;
  }
  return total > 0 ? young / total : null;
}
