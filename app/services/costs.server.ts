import db from "../db.server";
import { SHOP_TIMEZONE, dayKey } from "../lib/profit.ts";
import type { CostRow, ExpenseRow } from "../lib/profit.ts";
import { getSettings } from "./orderSync.server";

const EPOCH = new Date("2000-01-01T00:00:00Z");

async function ensureShop(shop: string) {
  await db.shop.upsert({ where: { shop }, create: { shop }, update: {} });
}

export async function loadCostRows(shop: string): Promise<CostRow[]> {
  const rows = await db.productVariantCost.findMany({ where: { shop } });
  return rows.map((r) => ({ variantId: r.variantId, unitCost: Number(r.unitCost), effectiveFrom: r.effectiveFrom }));
}

export async function loadExpenseRows(shop: string): Promise<(ExpenseRow & { id: string })[]> {
  const rows = await db.expense.findMany({ where: { shop }, orderBy: { startDate: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    amount: Number(r.amount),
    recurrence: (r.recurrence as ExpenseRow["recurrence"]) ?? "one_off",
    startDate: r.startDate,
    endDate: r.endDate,
  }));
}

export interface VariantRow {
  variantId: string;
  title: string;
  sku: string | null;
  unitsSold: number;
  lastPrice: number;
  currentCost: number | null;
}

// Every product variant seen on an order, with its current cost (if any).
export async function getVariantRows(shop: string): Promise<VariantRow[]> {
  const [lines, costs] = await Promise.all([
    db.orderLine.findMany({
      where: { shop, variantId: { not: null }, order: { excluded: false } },
      select: { variantId: true, title: true, sku: true, quantity: true, unitPrice: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    loadCostRows(shop),
  ]);

  const now = new Date();
  const byVariant = new Map<string, VariantRow>();
  for (const l of lines) {
    if (!l.variantId) continue;
    const existing = byVariant.get(l.variantId);
    if (existing) {
      existing.unitsSold += l.quantity;
    } else {
      // lines are newest first, so the first one seen carries the latest title and price
      let current: number | null = null;
      let bestDate = 0;
      for (const c of costs) {
        if (c.variantId === l.variantId && c.effectiveFrom <= now && c.effectiveFrom.getTime() >= bestDate) {
          current = c.unitCost;
          bestDate = c.effectiveFrom.getTime();
        }
      }
      byVariant.set(l.variantId, {
        variantId: l.variantId,
        title: l.title,
        sku: l.sku,
        unitsSold: l.quantity,
        lastPrice: Number(l.unitPrice),
        currentCost: current,
      });
    }
  }
  return [...byVariant.values()].sort((a, b) => b.unitsSold - a.unitsSold);
}

// Save a product cost. The first cost for a variant applies to all history; a later change applies from
// today (shop timezone) so past orders keep the cost that was true at the time.
export async function saveVariantCost(shop: string, variantId: string, title: string, unitCost: number) {
  await ensureShop(shop);
  const existing = await db.productVariantCost.count({ where: { shop, variantId } });
  let effectiveFrom = EPOCH;
  if (existing > 0) {
    // start of today in the shop timezone (Tunisia has no daylight saving: UTC+1)
    effectiveFrom = new Date(`${dayKey(new Date(), SHOP_TIMEZONE)}T00:00:00+01:00`);
  }
  await db.productVariantCost.upsert({
    where: { shop_variantId_minQuantity_effectiveFrom: { shop, variantId, minQuantity: 1, effectiveFrom } },
    create: { shop, variantId, title, unitCost: unitCost.toString(), minQuantity: 1, effectiveFrom },
    update: { unitCost: unitCost.toString(), title },
  });
}

export async function saveFees(shop: string, feeOut: number, feeReturn: number) {
  await ensureShop(shop);
  for (const [key, value] of [
    ["fee_out", feeOut],
    ["fee_return", feeReturn],
  ] as const) {
    await db.setting.upsert({
      where: { shop_key: { shop, key } },
      create: { shop, key, value },
      update: { value },
    });
  }
}

export async function addExpense(
  shop: string,
  e: { label: string; amount: number; recurrence: "one_off" | "monthly" | "weekly"; startDate: Date; endDate: Date | null },
) {
  await ensureShop(shop);
  await db.expense.create({
    data: {
      shop,
      label: e.label,
      amount: e.amount.toString(),
      currency: "TND",
      recurrence: e.recurrence,
      startDate: e.startDate,
      endDate: e.endDate,
    },
  });
}

export async function deleteExpense(shop: string, id: string) {
  await db.expense.deleteMany({ where: { shop, id } });
}

export async function getCostsPage(shop: string) {
  const [variants, settings, expenses] = await Promise.all([getVariantRows(shop), getSettings(shop), loadExpenseRows(shop)]);
  return {
    variants,
    feeOut: settings.fee_out,
    feeReturn: settings.fee_return,
    expenses: expenses.map((e) => ({
      id: e.id,
      label: e.label,
      amount: e.amount,
      recurrence: e.recurrence,
      startDate: e.startDate.toISOString().slice(0, 10),
      endDate: e.endDate ? e.endDate.toISOString().slice(0, 10) : null,
    })),
    missingCount: variants.filter((v) => v.currentCost === null).length,
  };
}
