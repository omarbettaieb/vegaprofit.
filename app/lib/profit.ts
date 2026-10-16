import type { Lifecycle, View } from "./types.ts";
import { countsInView } from "./lifecycle.ts";

// Profit engine (pure functions, no database). Rules approved by Omar:
//   - Delivery is a fixed fee per shipped order (feeOut). A returned or refused parcel costs the outbound fee
//     plus the return fee (feeReturn), and the product goes back to stock (no COGS, no revenue).
//   - Cancelled orders (never shipped) cost nothing.
//   - Gross view: everything not reversed (placed, in transit, delivered, partially refunded).
//   - Net view: delivered money only. Returned-parcel shipping losses count in BOTH views: it is real money.
//   - Revenue = order total (includes any shipping charged to the customer) minus refunds.
//   - Product cost = the unit cost in force on the order date.

export const SHOP_TIMEZONE = "Africa/Tunis";

export interface CostRow {
  variantId: string;
  unitCost: number;
  effectiveFrom: Date;
}

export interface ProfitLine {
  variantId: string | null;
  quantity: number;
}

export interface ProfitOrder {
  id: string;
  name: string;
  createdAt: Date;
  lifecycle: Lifecycle;
  totalPrice: number;
  totalRefunded: number;
  lines: ProfitLine[];
}

export interface Fees {
  feeOut: number; // courier fee for every shipped parcel
  feeReturn: number; // extra fee when the parcel comes back
}

export interface ExpenseRow {
  label: string;
  amount: number;
  recurrence: "one_off" | "monthly" | "weekly";
  startDate: Date;
  endDate: Date | null;
}

export interface OrderProfit {
  counted: boolean; // contributes to revenue/COGS in this view
  revenue: number;
  cogs: number;
  delivery: number;
  returnsLoss: number; // part of `delivery` caused by returned/refunded parcels
  profit: number;
  missingCost: boolean; // at least one line had no product cost, so COGS is understated
}

// Latest cost whose effective date is on or before the order date. null when none applies.
export function unitCostFor(variantId: string | null, at: Date, costs: CostRow[]): number | null {
  if (!variantId) return null;
  let best: CostRow | null = null;
  for (const c of costs) {
    if (c.variantId !== variantId || c.effectiveFrom.getTime() > at.getTime()) continue;
    if (!best || c.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = c;
  }
  return best ? best.unitCost : null;
}

function cogsFor(order: ProfitOrder, costs: CostRow[]): { cogs: number; missing: boolean } {
  let cogs = 0;
  let missing = false;
  for (const line of order.lines) {
    const unit = unitCostFor(line.variantId, order.createdAt, costs);
    if (unit === null) missing = true;
    else cogs += unit * line.quantity;
  }
  return { cogs, missing };
}

const ZERO: OrderProfit = { counted: false, revenue: 0, cogs: 0, delivery: 0, returnsLoss: 0, profit: 0, missingCost: false };

export function orderProfit(order: ProfitOrder, costs: CostRow[], fees: Fees, view: View): OrderProfit {
  const l = order.lifecycle;

  // Returned or fully refunded parcel: shipped out and came back. Lost shipping, no revenue, product restocked.
  if (l === "RETURNED" || l === "REFUNDED") {
    const loss = fees.feeOut + fees.feeReturn;
    return { ...ZERO, delivery: loss, returnsLoss: loss, profit: -loss };
  }
  // Cancelled before shipping: no money moved.
  if (l === "CANCELLED") return { ...ZERO };

  if (!countsInView(l, view)) return { ...ZERO };

  const revenue = order.totalPrice - order.totalRefunded;
  const { cogs, missing } = cogsFor(order, costs);
  // Gross view projects the courier fee for parcels not yet shipped; net only has delivered (shipped) orders.
  const delivery = fees.feeOut;
  return {
    counted: true,
    revenue,
    cogs,
    delivery,
    returnsLoss: 0,
    profit: revenue - cogs - delivery,
    missingCost: missing,
  };
}

// ---------- days ----------

// "YYYY-MM-DD" of an instant in the shop's timezone (orders belong to the day they were placed locally).
export function dayKey(d: Date, timeZone: string = SHOP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcToKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// Inclusive list of day keys. Capped at 400 days to keep reports cheap.
export function daysBetween(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  const end = keyToUtc(toKey);
  for (let t = keyToUtc(fromKey); t <= end && out.length < 400; t += 86_400_000) out.push(utcToKey(t));
  return out;
}

// Move a "YYYY-MM-DD" key by n days (negative goes back).
export function shiftDay(key: string, n: number): string {
  return utcToKey(keyToUtc(key) + n * 86_400_000);
}

export function firstOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

function daysInMonthOf(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Amount of one expense that falls on one day. One-off: whole amount on its date. Monthly: spread evenly over
// the days of that month. Weekly: one seventh per day. Active from startDate to endDate (inclusive) when set.
export function expenseOnDay(e: ExpenseRow, key: string, timeZone: string = SHOP_TIMEZONE): number {
  const startKey = dayKey(e.startDate, timeZone);
  if (key < startKey) return 0;
  if (e.endDate && key > dayKey(e.endDate, timeZone)) return 0;
  if (e.recurrence === "one_off") return key === startKey ? e.amount : 0;
  if (e.recurrence === "weekly") return e.amount / 7;
  return e.amount / daysInMonthOf(key);
}

// ---------- report ----------

export interface DayRow {
  date: string;
  orders: number;
  revenue: number;
  cogs: number;
  delivery: number;
  expenses: number;
  profit: number; // before ads
  adSpend: number;
  profitAfterAds: number;
}

export interface Report {
  view: View;
  days: DayRow[];
  totals: {
    orders: number;
    revenue: number;
    cogs: number;
    delivery: number;
    returnsLoss: number;
    expenses: number;
    profit: number; // before ads
    adSpend: number;
    profitAfterAds: number;
    marginPct: number | null; // profit / revenue, null when no revenue
    avgOrderValue: number | null;
    returnedParcels: number;
  };
  ordersMissingCost: number;
}

export function buildReport(
  orders: ProfitOrder[],
  costs: CostRow[],
  fees: Fees,
  expenses: ExpenseRow[],
  fromKey: string,
  toKey: string,
  view: View,
  timeZone: string = SHOP_TIMEZONE,
  adSpendByDay: Record<string, number> = {},
): Report {
  const keys = daysBetween(fromKey, toKey);
  const byDay = new Map<string, DayRow>();
  for (const k of keys) {
    byDay.set(k, { date: k, orders: 0, revenue: 0, cogs: 0, delivery: 0, expenses: 0, profit: 0, adSpend: 0, profitAfterAds: 0 });
  }

  let returnsLoss = 0;
  let returnedParcels = 0;
  let ordersMissingCost = 0;

  for (const o of orders) {
    const row = byDay.get(dayKey(o.createdAt, timeZone));
    if (!row) continue; // outside the range
    const p = orderProfit(o, costs, fees, view);
    if (p.counted) row.orders += 1;
    row.revenue += p.revenue;
    row.cogs += p.cogs;
    row.delivery += p.delivery;
    row.profit += p.profit;
    returnsLoss += p.returnsLoss;
    if (p.returnsLoss > 0) returnedParcels += 1;
    if (p.missingCost) ordersMissingCost += 1;
  }

  for (const row of byDay.values()) {
    let exp = 0;
    for (const e of expenses) exp += expenseOnDay(e, row.date, timeZone);
    row.expenses = exp;
    row.profit -= exp;
    row.adSpend = adSpendByDay[row.date] ?? 0;
    row.profitAfterAds = row.profit - row.adSpend;
  }

  const days = keys.map((k) => byDay.get(k)!);
  const sum = (f: (d: DayRow) => number) => days.reduce((a, d) => a + f(d), 0);
  const revenue = sum((d) => d.revenue);
  const profit = sum((d) => d.profit);
  const orderCount = sum((d) => d.orders);

  return {
    view,
    days,
    totals: {
      orders: orderCount,
      revenue,
      cogs: sum((d) => d.cogs),
      delivery: sum((d) => d.delivery),
      returnsLoss,
      expenses: sum((d) => d.expenses),
      profit,
      adSpend: sum((d) => d.adSpend),
      profitAfterAds: sum((d) => d.profitAfterAds),
      marginPct: revenue > 0 ? (profit / revenue) * 100 : null,
      avgOrderValue: orderCount > 0 ? revenue / orderCount : null,
      returnedParcels,
    },
    ordersMissingCost,
  };
}
