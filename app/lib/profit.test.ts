import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReport,
  firstOfMonth,
  shiftDay,
  dayKey,
  daysBetween,
  expenseOnDay,
  orderProfit,
  unitCostFor,
} from "./profit.ts";
import type { CostRow, ExpenseRow, Fees, ProfitOrder } from "./profit.ts";

const fees: Fees = { feeOut: 7, feeReturn: 5 };
const costs: CostRow[] = [
  { variantId: "v1", unitCost: 20, effectiveFrom: new Date("2000-01-01T00:00:00Z") },
  { variantId: "v1", unitCost: 25, effectiveFrom: new Date("2026-10-10T00:00:00Z") },
  { variantId: "v2", unitCost: 10, effectiveFrom: new Date("2000-01-01T00:00:00Z") },
];

function order(over: Partial<ProfitOrder> = {}): ProfitOrder {
  return {
    id: "o1",
    name: "#1",
    createdAt: new Date("2026-10-12T10:00:00Z"),
    lifecycle: "DELIVERED",
    totalPrice: 100,
    totalRefunded: 0,
    lines: [{ variantId: "v1", quantity: 2 }],
    ...over,
  };
}

test("unitCostFor uses the cost in force on the order date", () => {
  assert.equal(unitCostFor("v1", new Date("2026-10-09T00:00:00Z"), costs), 20);
  assert.equal(unitCostFor("v1", new Date("2026-10-11T00:00:00Z"), costs), 25);
  assert.equal(unitCostFor("nope", new Date("2026-10-11T00:00:00Z"), costs), null);
  assert.equal(unitCostFor(null, new Date("2026-10-11T00:00:00Z"), costs), null);
});

test("delivered order: revenue minus cogs minus courier fee", () => {
  const p = orderProfit(order(), costs, fees, "net");
  assert.equal(p.revenue, 100);
  assert.equal(p.cogs, 50); // 2 x 25
  assert.equal(p.delivery, 7);
  assert.equal(p.profit, 43);
  assert.equal(p.missingCost, false);
});

test("missing product cost is flagged and understates cogs only", () => {
  const p = orderProfit(order({ lines: [{ variantId: "v1", quantity: 1 }, { variantId: "zzz", quantity: 3 }] }), costs, fees, "net");
  assert.equal(p.missingCost, true);
  assert.equal(p.cogs, 25);
});

test("partial refund reduces revenue", () => {
  const p = orderProfit(order({ lifecycle: "PARTIALLY_REFUNDED", totalRefunded: 30 }), costs, fees, "net");
  assert.equal(p.revenue, 70);
});

test("cancelled order costs nothing", () => {
  const p = orderProfit(order({ lifecycle: "CANCELLED" }), costs, fees, "gross");
  assert.deepEqual([p.counted, p.revenue, p.cogs, p.delivery, p.profit], [false, 0, 0, 0, 0]);
});

test("returned parcel loses outbound + return fee in both views, no revenue, no cogs", () => {
  for (const view of ["gross", "net"] as const) {
    const p = orderProfit(order({ lifecycle: "RETURNED" }), costs, fees, view);
    assert.equal(p.counted, false);
    assert.equal(p.revenue, 0);
    assert.equal(p.cogs, 0);
    assert.equal(p.delivery, 12);
    assert.equal(p.returnsLoss, 12);
    assert.equal(p.profit, -12);
  }
});

test("gross counts placed and in transit, net does not", () => {
  for (const lifecycle of ["PLACED", "IN_TRANSIT"] as const) {
    assert.equal(orderProfit(order({ lifecycle }), costs, fees, "gross").counted, true);
    assert.equal(orderProfit(order({ lifecycle }), costs, fees, "net").counted, false);
  }
});

test("dayKey uses the Tunis calendar day", () => {
  assert.equal(dayKey(new Date("2026-10-14T23:30:00Z")), "2026-10-15"); // UTC+1
  assert.equal(dayKey(new Date("2026-10-14T10:00:00Z")), "2026-10-14");
});

test("daysBetween is inclusive and handles month ends", () => {
  assert.deepEqual(daysBetween("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(daysBetween("2026-10-05", "2026-10-05"), ["2026-10-05"]);
  assert.deepEqual(daysBetween("2026-10-06", "2026-10-05"), []);
});

test("expenses: one-off lands on its day, monthly is spread, weekly is a seventh, end date stops it", () => {
  const oneOff: ExpenseRow = { label: "x", amount: 90, recurrence: "one_off", startDate: new Date("2026-10-12T09:00:00Z"), endDate: null };
  assert.equal(expenseOnDay(oneOff, "2026-10-12"), 90);
  assert.equal(expenseOnDay(oneOff, "2026-10-13"), 0);

  const monthly: ExpenseRow = { label: "rent", amount: 310, recurrence: "monthly", startDate: new Date("2026-10-01T09:00:00Z"), endDate: null };
  assert.equal(expenseOnDay(monthly, "2026-10-20"), 10); // 31 days
  assert.equal(expenseOnDay(monthly, "2026-09-30"), 0); // before start

  const weekly: ExpenseRow = { label: "w", amount: 70, recurrence: "weekly", startDate: new Date("2026-10-01T09:00:00Z"), endDate: new Date("2026-10-10T09:00:00Z") };
  assert.equal(expenseOnDay(weekly, "2026-10-05"), 10);
  assert.equal(expenseOnDay(weekly, "2026-10-11"), 0);
});

test("report: totals, days, returned parcels, missing costs, expenses", () => {
  const orders: ProfitOrder[] = [
    order({ id: "a", createdAt: new Date("2026-10-12T10:00:00Z") }), // delivered, profit 43
    order({ id: "b", createdAt: new Date("2026-10-12T11:00:00Z"), lifecycle: "RETURNED" }), // -12
    order({ id: "c", createdAt: new Date("2026-10-13T11:00:00Z"), lifecycle: "IN_TRANSIT", lines: [{ variantId: "zzz", quantity: 1 }] }),
    order({ id: "d", createdAt: new Date("2026-09-01T11:00:00Z") }), // outside range
  ];
  const expenses: ExpenseRow[] = [{ label: "rent", amount: 310, recurrence: "monthly", startDate: new Date("2026-10-01T09:00:00Z"), endDate: null }];

  const net = buildReport(orders, costs, fees, expenses, "2026-10-12", "2026-10-13", "net");
  assert.equal(net.days.length, 2);
  assert.equal(net.days[0].orders, 1);
  assert.equal(net.totals.revenue, 100);
  assert.equal(net.totals.returnsLoss, 12);
  assert.equal(net.totals.returnedParcels, 1);
  assert.equal(net.totals.expenses, 20); // 2 days x 10
  assert.equal(net.totals.profit, 43 - 12 - 20);
  assert.equal(net.ordersMissingCost, 0); // the in-transit one is not in the net view

  const gross = buildReport(orders, costs, fees, expenses, "2026-10-12", "2026-10-13", "gross");
  assert.equal(gross.totals.orders, 2);
  assert.equal(gross.ordersMissingCost, 1);
  assert.ok(gross.totals.marginPct !== null);
});

test("report with no orders has null margin and average", () => {
  const r = buildReport([], costs, fees, [], "2026-10-12", "2026-10-12", "net");
  assert.equal(r.totals.marginPct, null);
  assert.equal(r.totals.avgOrderValue, null);
});

test("shiftDay and firstOfMonth", () => {
  assert.equal(shiftDay("2026-10-15", -6), "2026-10-09");
  assert.equal(shiftDay("2026-10-30", 3), "2026-11-02");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(firstOfMonth("2026-10-15"), "2026-10-01");
});
