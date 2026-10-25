import test from "node:test";
import assert from "node:assert/strict";
import { provisionalShare, reconcile, reversalLag, staleOrders } from "./reconcile.ts";
import type { RecOrder } from "./reconcile.ts";

const d = (s: string) => new Date(`${s}T10:00:00Z`);
const o = (id: string, lifecycle: RecOrder["lifecycle"], total: number, extra: Partial<RecOrder> = {}): RecOrder => ({
  id, name: `#${id}`, createdKey: "2026-10-10", createdAt: d("2026-10-10"), lifecycle, excluded: false, totalPrice: total, totalRefunded: 0, cancelledAt: null, ...extra,
});

test("every order lands in exactly one bucket and the buckets add up to placed", () => {
  const t = reconcile([
    o("1", "DELIVERED", 100),
    o("2", "IN_TRANSIT", 50),
    o("3", "CANCELLED", 40, { cancelledAt: d("2026-10-12") }),
    o("4", "RETURNED", 60, { cancelledAt: d("2026-10-15") }),
    o("5", "DELIVERED", 80, { excluded: true }),
    o("6", "PARTIALLY_REFUNDED", 90, { totalRefunded: 30 }),
  ]);
  assert.deepEqual([t.placed.orders, t.placed.value], [6, 420]);
  assert.deepEqual([t.fake.orders, t.fake.value], [1, 80]);
  assert.deepEqual([t.reversed.orders, t.reversed.value], [2, 130]); // 40 + 60 + 30 refunded part
  assert.deepEqual([t.open.orders, t.open.value], [1, 50]);
  assert.deepEqual([t.delivered.orders, t.delivered.value], [2, 160]); // 100 + 60 left of order 6
  assert.equal(t.fake.value + t.reversed.value + t.open.value + t.delivered.value, t.placed.value);
  assert.deepEqual([t.real.orders, t.real.value], [3, 210]);
});

test("reversal lag measures days from order to cancellation", () => {
  const lag = reversalLag([
    o("1", "CANCELLED", 10, { cancelledAt: d("2026-10-11") }),
    o("2", "CANCELLED", 10, { cancelledAt: d("2026-10-13") }),
    o("3", "RETURNED", 10, { cancelledAt: d("2026-10-30") }),
    o("4", "DELIVERED", 10),
  ]);
  assert.equal(lag.count, 3);
  assert.equal(lag.medianDays, 3);
  assert.equal(lag.maxDays, 20);
  assert.equal(reversalLag([]).medianDays, null);
});

test("stale orders are placed or in transit for at least N days", () => {
  const now = d("2026-10-25");
  const s = staleOrders([o("1", "IN_TRANSIT", 10), o("2", "IN_TRANSIT", 10, { createdAt: d("2026-10-22") }), o("3", "DELIVERED", 10)], now, 7);
  assert.deepEqual(s.map((x) => x.id), ["1"]);
  assert.equal(s[0].ageDays, 15);
});

test("provisional share counts value younger than the final window", () => {
  const now = d("2026-10-25");
  const share = provisionalShare([o("1", "DELIVERED", 100), o("2", "IN_TRANSIT", 100, { createdAt: d("2026-10-20") })], now, 30);
  assert.equal(share, 1);
  assert.equal(provisionalShare([o("1", "DELIVERED", 100, { createdAt: d("2026-08-01") })], now, 30), 0);
});
