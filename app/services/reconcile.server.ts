import db from "../db.server";
import { addOrder, emptyTotals, provisionalShare, reconcile, reversalLag, staleOrders } from "../lib/reconcile.ts";
import type { RecOrder, RecTotals } from "../lib/reconcile.ts";
import { dayKey, shiftDay } from "../lib/profit.ts";
import type { Lifecycle } from "../lib/types.ts";
import { getSettings } from "./orderSync.server";

const WINDOW = "7d_click,1d_view";

export interface RecDay {
  date: string;
  totals: RecTotals;
  metaPurchases: number;
  metaRevenueTnd: number;
  spendTnd: number;
}

export interface ReversalPosted {
  name: string;
  createdKey: string;
  reversedKey: string;
  lagDays: number;
  value: number;
  campaign: string | null;
  olderThanPeriod: boolean;
  lifecycle: string;
}

export async function getReconciliation(shop: string, fromKey: string, toKey: string) {
  const settings = await getSettings(shop);
  const rate = settings.fx_usd_tnd;
  const now = new Date();
  const today = dayKey(now);
  const since = new Date(`${shiftDay(today, -90)}T00:00:00Z`);

  const [rows, insights, refunds, campaigns] = await Promise.all([
    db.order.findMany({
      where: { shop, createdAtShopify: { gte: since } },
      select: {
        id: true, name: true, createdAtShopify: true, lifecycle: true, excluded: true, totalPrice: true, totalRefunded: true, cancelledAt: true,
        attribution: { select: { campaignId: true } },
      },
      orderBy: { createdAtShopify: "asc" },
    }),
    db.metaInsightsDaily.groupBy({
      by: ["date"],
      where: { shop, level: "AD", attributionWindow: WINDOW, date: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKey}T00:00:00Z`) } },
      _sum: { metaPurchases: true, metaPurchaseValue: true, spend: true },
    }),
    db.refund.findMany({
      where: { shop, refundedAt: { gte: new Date(`${fromKey}T00:00:00Z`), lt: new Date(`${shiftDay(toKey, 1)}T00:00:00Z`) } },
      select: { amount: true },
    }),
    db.metaCampaign.findMany({ where: { shop }, select: { metaId: true, name: true } }),
  ]);
  const campaignName = new Map(campaigns.map((c) => [c.metaId, c.name]));

  const all: (RecOrder & { campaignId: string | null })[] = rows.map((o) => ({
    id: o.id,
    name: o.name,
    createdKey: dayKey(o.createdAtShopify),
    createdAt: o.createdAtShopify,
    lifecycle: o.lifecycle as Lifecycle,
    excluded: o.excluded,
    totalPrice: Number(o.totalPrice),
    totalRefunded: Number(o.totalRefunded),
    cancelledAt: o.cancelledAt,
    campaignId: o.attribution?.campaignId ?? null,
  }));

  const inPeriod = all.filter((o) => o.createdKey >= fromKey && o.createdKey <= toKey);

  const byDay = new Map<string, RecTotals>();
  for (const o of inPeriod) {
    let t = byDay.get(o.createdKey);
    if (!t) byDay.set(o.createdKey, (t = emptyTotals()));
    addOrder(t, o);
  }
  const metaDay = new Map(insights.map((r) => [r.date.toISOString().slice(0, 10), r]));
  const days: RecDay[] = [];
  for (let k = fromKey; k <= toKey && days.length < 120; k = shiftDay(k, 1)) {
    const m = metaDay.get(k);
    days.push({
      date: k,
      totals: byDay.get(k) ?? emptyTotals(),
      metaPurchases: m?._sum.metaPurchases ?? 0,
      metaRevenueTnd: Number(m?._sum.metaPurchaseValue ?? 0) * rate,
      spendTnd: Number(m?._sum.spend ?? 0) * rate,
    });
  }

  // Reversals that were POSTED in the period, whatever day the order was placed. This is the way Shopify's own
  // reports count them, and it is what makes a Shopify month differ from the order-day view above.
  const reversalsPosted: ReversalPosted[] = all
    .filter((o) => !o.excluded && o.cancelledAt && ["CANCELLED", "RETURNED", "REFUNDED"].includes(o.lifecycle))
    .map((o) => ({ o, rk: dayKey(o.cancelledAt!) }))
    .filter(({ rk }) => rk >= fromKey && rk <= toKey)
    .map(({ o, rk }) => ({
      name: o.name,
      createdKey: o.createdKey,
      reversedKey: rk,
      lagDays: Math.max(0, Math.round((Date.parse(rk) - Date.parse(o.createdKey)) / 86_400_000)),
      value: o.totalPrice,
      campaign: o.campaignId ? campaignName.get(o.campaignId) ?? o.campaignId : null,
      olderThanPeriod: o.createdKey < fromKey,
      lifecycle: o.lifecycle,
    }))
    .sort((a, b) => b.reversedKey.localeCompare(a.reversedKey));

  const metaPurchases = days.reduce((a, d) => a + d.metaPurchases, 0);
  const metaRevenueTnd = days.reduce((a, d) => a + d.metaRevenueTnd, 0);
  const spendTnd = days.reduce((a, d) => a + d.spendTnd, 0);

  return {
    totals: reconcile(inPeriod),
    days,
    metaPurchases,
    metaRevenueTnd,
    spendTnd,
    reversalsPosted,
    refundedPosted: refunds.reduce((a, r) => a + Number(r.amount), 0),
    lag: reversalLag(all),
    stale: staleOrders(all, now, settings.stale_days).map((o) => ({
      name: o.name, ageDays: o.ageDays, value: o.totalPrice - o.totalRefunded, lifecycle: o.lifecycle,
      campaign: o.campaignId ? campaignName.get(o.campaignId) ?? o.campaignId : null,
    })),
    provisional: provisionalShare(inPeriod, now, settings.final_after_days),
    staleDays: settings.stale_days,
    finalAfterDays: settings.final_after_days,
    ratesMissing: rate === 0,
  };
}
