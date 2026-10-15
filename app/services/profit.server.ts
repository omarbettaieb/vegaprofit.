import db from "../db.server";
import { buildReport, shiftDay } from "../lib/profit.ts";
import type { ProfitOrder, Report } from "../lib/profit.ts";
import type { View } from "../lib/types.ts";
import { loadCostRows, loadExpenseRows } from "./costs.server";
import { getSettings } from "./orderSync.server";

export interface ProfitResult {
  report: Report;
  feeOut: number;
  feeReturn: number;
  fromKey: string;
  toKey: string;
}

// Profit for a day range (inclusive, shop timezone). Excluded (fake) orders never count.
export async function getProfitReport(shop: string, fromKey: string, toKey: string, view: View): Promise<ProfitResult> {
  // Fetch one extra day each side: the day boundary is applied in the shop timezone inside buildReport.
  const lower = new Date(`${shiftDay(fromKey, -1)}T00:00:00Z`);
  const upper = new Date(`${shiftDay(toKey, 2)}T00:00:00Z`);

  const [orders, costs, expenses, settings] = await Promise.all([
    db.order.findMany({
      where: { shop, excluded: false, createdAtShopify: { gte: lower, lt: upper } },
      select: {
        id: true,
        name: true,
        createdAtShopify: true,
        lifecycle: true,
        totalPrice: true,
        totalRefunded: true,
        lines: { select: { variantId: true, quantity: true } },
      },
    }),
    loadCostRows(shop),
    loadExpenseRows(shop),
    getSettings(shop),
  ]);

  const profitOrders: ProfitOrder[] = orders.map((o) => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAtShopify,
    lifecycle: o.lifecycle,
    totalPrice: Number(o.totalPrice),
    totalRefunded: Number(o.totalRefunded),
    lines: o.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
  }));

  const fees = { feeOut: settings.fee_out, feeReturn: settings.fee_return };
  return {
    report: buildReport(profitOrders, costs, fees, expenses, fromKey, toKey, view),
    feeOut: fees.feeOut,
    feeReturn: fees.feeReturn,
    fromKey,
    toKey,
  };
}
