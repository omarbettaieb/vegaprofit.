import { Prisma } from "@prisma/client";
import db from "../db.server";
import { parseInsightRow } from "../lib/meta.ts";
import type { GraphInsightRow, InsightRow } from "../lib/meta.ts";
import { computeTruth, dayChecks, DEFAULT_LIMITS } from "../lib/truth.ts";
import type { DayCheck, Truth } from "../lib/truth.ts";
import { dayKey, orderProfit, shiftDay } from "../lib/profit.ts";
import type { ProfitOrder } from "../lib/profit.ts";
import type { Lifecycle } from "../lib/types.ts";
import { loadCostRows } from "./costs.server";
import { getSettings } from "./orderSync.server";

const WINDOW = "7d_click,1d_view";
const SYNC_DAYS = 60;

export interface MetaConfig {
  token: string;
  adAccountId: string;
  version: string;
}

export function metaConfig(): MetaConfig | null {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const id = process.env.META_AD_ACCOUNT_ID?.trim().replace(/^act_/, "");
  if (!token || !id) return null;
  return { token, adAccountId: id, version: process.env.META_API_VERSION?.trim() || "v23.0" };
}

interface GraphPage {
  data?: GraphInsightRow[];
  paging?: { next?: string };
  error?: { message?: string; code?: number };
}

async function fetchInsights(cfg: MetaConfig, since: string, until: string): Promise<InsightRow[]> {
  const params = new URLSearchParams({
    level: "ad",
    fields: [
      "date_start", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name",
      "spend", "impressions", "clicks", "frequency", "actions", "action_values",
    ].join(","),
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    action_attribution_windows: JSON.stringify(["7d_click", "1d_view"]),
    limit: "500",
    access_token: cfg.token,
  });
  let url: string | undefined = `https://graph.facebook.com/${cfg.version}/act_${cfg.adAccountId}/insights?${params}`;
  const rows: InsightRow[] = [];
  for (let page = 0; url && page < 40; page++) {
    const res = await fetch(url);
    const body = (await res.json()) as GraphPage;
    if (!res.ok || body.error) {
      // Never put the token in an error message.
      throw new Error(`Meta said: ${body.error?.message ?? res.statusText} (code ${body.error?.code ?? res.status})`);
    }
    for (const r of body.data ?? []) {
      const parsed = parseInsightRow(r);
      if (parsed) rows.push(parsed);
    }
    url = body.paging?.next;
  }
  return rows;
}

async function setSetting(shop: string, key: string, value: Prisma.InputJsonValue) {
  await db.shop.upsert({ where: { shop }, create: { shop }, update: {} });
  await db.setting.upsert({
    where: { shop_key: { shop, key } },
    create: { shop, key, value },
    update: { value },
  });
}

export async function getMetaStatus(shop: string): Promise<{ configured: boolean; lastSyncAt: string | null; error: string | null }> {
  const rows = await db.setting.findMany({ where: { shop, key: { in: ["meta_last_sync_at", "meta_last_error"] } } });
  const get = (k: string) => (rows.find((r) => r.key === k)?.value as string | undefined) ?? null;
  return { configured: metaConfig() !== null, lastSyncAt: get("meta_last_sync_at"), error: get("meta_last_error") };
}

// Pulls the last 60 days at ad level, one row per ad per day, and upserts the entity names and daily numbers.
export async function syncMeta(shop: string): Promise<{ rows: number }> {
  const cfg = metaConfig();
  if (!cfg) throw new Error("META_ACCESS_TOKEN or META_AD_ACCOUNT_ID is missing in the Render environment.");
  const today = dayKey(new Date());
  try {
    const rows = await fetchInsights(cfg, shiftDay(today, -(SYNC_DAYS - 1)), today);
    await db.shop.upsert({ where: { shop }, create: { shop }, update: {} });
    await db.metaAccount.upsert({
      where: { shop_adAccountId: { shop, adAccountId: cfg.adAccountId } },
      create: { shop, adAccountId: cfg.adAccountId, lastSyncAt: new Date() },
      update: { lastSyncAt: new Date() },
    });

    // Entities, deduplicated.
    const campaigns = new Map<string, string>();
    const adSets = new Map<string, { name: string; campaignMetaId: string }>();
    const ads = new Map<string, { name: string; adSetMetaId: string }>();
    for (const r of rows) {
      campaigns.set(r.campaignId, r.campaignName);
      adSets.set(r.adSetId, { name: r.adSetName, campaignMetaId: r.campaignId });
      ads.set(r.adId, { name: r.adName, adSetMetaId: r.adSetId });
    }
    const campaignDb = new Map<string, string>();
    for (const [metaId, name] of campaigns) {
      const c = await db.metaCampaign.upsert({
        where: { shop_metaId: { shop, metaId } },
        create: { shop, metaId, name },
        update: { name },
      });
      campaignDb.set(metaId, c.id);
    }
    const adSetDb = new Map<string, string>();
    for (const [metaId, s] of adSets) {
      const a = await db.metaAdSet.upsert({
        where: { shop_metaId: { shop, metaId } },
        create: { shop, metaId, name: s.name, campaignId: campaignDb.get(s.campaignMetaId)! },
        update: { name: s.name, campaignId: campaignDb.get(s.campaignMetaId)! },
      });
      adSetDb.set(metaId, a.id);
    }
    for (const [metaId, a] of ads) {
      await db.metaAd.upsert({
        where: { shop_metaId: { shop, metaId } },
        create: { shop, metaId, name: a.name, adSetId: adSetDb.get(a.adSetMetaId)! },
        update: { name: a.name, adSetId: adSetDb.get(a.adSetMetaId)! },
      });
    }

    // Daily numbers. Replace the synced window so rows Meta no longer reports do not linger.
    const from = new Date(`${shiftDay(today, -(SYNC_DAYS - 1))}T00:00:00Z`);
    await db.$transaction([
      db.metaInsightsDaily.deleteMany({ where: { shop, level: "AD", attributionWindow: WINDOW, date: { gte: from } } }),
      db.metaInsightsDaily.createMany({
        data: rows.map((r) => ({
          shop,
          level: "AD" as const,
          entityMetaId: r.adId,
          date: new Date(`${r.date}T00:00:00Z`),
          spend: r.spend,
          currency: "USD",
          impressions: r.impressions,
          clicks: r.clicks,
          frequency: r.frequency,
          metaPurchases: r.purchases,
          metaPurchaseValue: r.purchaseValue,
          attributionWindow: WINDOW,
        })),
      }),
    ]);
    await setSetting(shop, "meta_last_sync_at", new Date().toISOString());
    await setSetting(shop, "meta_last_error", "");
    return { rows: rows.length };
  } catch (e) {
    await setSetting(shop, "meta_last_error", e instanceof Error ? e.message : "Unknown error");
    throw e;
  }
}

// Sync on app open when the last sync is stale. Never throws.
export async function metaSyncIfDue(shop: string): Promise<void> {
  if (!metaConfig()) return;
  const [status, settings] = await Promise.all([getMetaStatus(shop), getSettings(shop)]);
  const ageHours = status.lastSyncAt ? (Date.now() - new Date(status.lastSyncAt).getTime()) / 3_600_000 : Infinity;
  if (ageHours < settings.meta_sync_interval_hours) return;
  try {
    await syncMeta(shop);
  } catch (e) {
    console.error("[meta-sync] failed", e instanceof Error ? e.message : e);
  }
}

// Ad spend per day in TND for the Profit page.
export async function getAdSpendByDay(shop: string, fromKey: string, toKey: string, rate: number): Promise<Record<string, number>> {
  const rows = await db.metaInsightsDaily.groupBy({
    by: ["date"],
    where: {
      shop,
      level: "AD",
      attributionWindow: WINDOW,
      date: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKey}T00:00:00Z`) },
    },
    _sum: { spend: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.date.toISOString().slice(0, 10)] = Number(r._sum.spend ?? 0) * rate;
  return out;
}

export type MetaLevelName = "campaign" | "adset" | "ad";

export interface TruthLine extends Truth {
  key: string;
  name: string;
  parent?: string;
  spendTnd: number;
  metaPurchases: number;
  clicks: number;
  impressions: number;
  trueOrders: number;
  reversedOrders: number;
  excludedOrders: number;
  revenueTnd: number;
  contributionTnd: number;
}

const REVERSED: Lifecycle[] = ["CANCELLED", "RETURNED", "REFUNDED"];

// Spend, Meta-reported purchases and what Shopify can prove, per campaign / ad set / ad for a day range.
export async function getMetaLines(
  shop: string,
  level: MetaLevelName,
  fromKey: string,
  toKey: string,
): Promise<{ lines: TruthLine[]; rate: number; unattributedOrders: number; ordersMissingCost: number }> {
  const settings = await getSettings(shop);
  const rate = settings.fx_usd_tnd;
  const from = new Date(`${fromKey}T00:00:00Z`);
  const to = new Date(`${toKey}T00:00:00Z`);
  const limits = {
    amberRatio: settings.tracking_amber_ratio,
    redRatio: settings.tracking_red_ratio,
    minPurchases: DEFAULT_LIMITS.minPurchases,
  };

  const [insights, ads, adSets, campaigns, orders, costs] = await Promise.all([
    db.metaInsightsDaily.findMany({ where: { shop, level: "AD", attributionWindow: WINDOW, date: { gte: from, lte: to } } }),
    db.metaAd.findMany({ where: { shop }, select: { metaId: true, name: true, adSet: { select: { metaId: true } } } }),
    db.metaAdSet.findMany({ where: { shop }, select: { metaId: true, name: true, campaign: { select: { metaId: true } } } }),
    db.metaCampaign.findMany({ where: { shop }, select: { metaId: true, name: true } }),
    db.order.findMany({
      where: {
        shop,
        createdAtShopify: { gte: new Date(`${shiftDay(fromKey, -1)}T00:00:00Z`), lt: new Date(`${shiftDay(toKey, 2)}T00:00:00Z`) },
      },
      select: {
        id: true,
        name: true,
        excluded: true,
        createdAtShopify: true,
        lifecycle: true,
        totalPrice: true,
        totalRefunded: true,
        lines: { select: { variantId: true, quantity: true } },
        attribution: { select: { campaignId: true, adSetId: true, adId: true } },
      },
    }),
    loadCostRows(shop),
  ]);

  const adSetOfAd = new Map(ads.map((a) => [a.metaId, a.adSet.metaId]));
  const campaignOfAdSet = new Map(adSets.map((s) => [s.metaId, s.campaign.metaId]));
  const names = new Map<string, string>();
  const parentName = new Map<string, string>();
  for (const c of campaigns) names.set(c.metaId, c.name);
  for (const s of adSets) {
    names.set(s.metaId, s.name);
    parentName.set(s.metaId, campaigns.find((c) => c.metaId === s.campaign.metaId)?.name ?? "");
  }
  for (const a of ads) {
    names.set(a.metaId, a.name);
    parentName.set(a.metaId, adSets.find((s) => s.metaId === a.adSet.metaId)?.name ?? "");
  }

  const keyOfAd = (adId: string): string | undefined => {
    if (level === "ad") return adId;
    const setId = adSetOfAd.get(adId);
    if (!setId) return undefined;
    return level === "adset" ? setId : campaignOfAdSet.get(setId);
  };

  interface Acc {
    spend: number; purchases: number; clicks: number; impressions: number;
    trueOrders: number; reversed: number; excluded: number; revenue: number; contribution: number;
  }
  const acc = new Map<string, Acc>();
  const slot = (k: string) => {
    let v = acc.get(k);
    if (!v) acc.set(k, (v = { spend: 0, purchases: 0, clicks: 0, impressions: 0, trueOrders: 0, reversed: 0, excluded: 0, revenue: 0, contribution: 0 }));
    return v;
  };
  for (const r of insights) {
    const k = keyOfAd(r.entityMetaId);
    if (!k) continue;
    const v = slot(k);
    v.spend += Number(r.spend) * rate;
    v.purchases += r.metaPurchases;
    v.clicks += r.clicks;
    v.impressions += r.impressions;
  }

  const fees = { feeOut: settings.fee_out, feeReturn: settings.fee_return };
  let unattributed = 0;
  let missingCost = 0;
  for (const o of orders) {
    const day = dayKey(o.createdAtShopify);
    if (day < fromKey || day > toKey) continue;
    const a = o.attribution;
    const k = level === "campaign" ? a?.campaignId : level === "adset" ? a?.adSetId : a?.adId;
    if (!k) {
      if (!o.excluded && !REVERSED.includes(o.lifecycle as Lifecycle)) unattributed += 1;
      continue;
    }
    const v = slot(k);
    if (o.excluded) {
      v.excluded += 1;
      continue;
    }
    if (REVERSED.includes(o.lifecycle as Lifecycle)) v.reversed += 1;
    else v.trueOrders += 1;

    const po: ProfitOrder = {
      id: o.id,
      name: o.name,
      createdAt: o.createdAtShopify,
      lifecycle: o.lifecycle as Lifecycle,
      totalPrice: Number(o.totalPrice),
      totalRefunded: Number(o.totalRefunded),
      lines: o.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    };
    const p = orderProfit(po, costs, fees, "gross");
    v.contribution += p.profit;
    if (p.counted) v.revenue += p.revenue;
    if (p.missingCost) missingCost += 1;
  }

  const lines: TruthLine[] = [...acc.entries()].map(([key, v]) => ({
    key,
    name: names.get(key) ?? key,
    parent: level === "campaign" ? undefined : parentName.get(key),
    spendTnd: v.spend,
    metaPurchases: v.purchases,
    clicks: v.clicks,
    impressions: v.impressions,
    trueOrders: v.trueOrders,
    reversedOrders: v.reversed,
    excludedOrders: v.excluded,
    revenueTnd: v.revenue,
    contributionTnd: v.contribution,
    ...computeTruth(
      { metaPurchases: v.purchases, trueOrders: v.trueOrders, reversedOrders: v.reversed, excludedOrders: v.excluded, spend: v.spend, revenue: v.revenue, contribution: v.contribution },
      limits,
    ),
  }));
  lines.sort((a, b) => b.spendTnd - a.spendTnd);
  return { lines, rate, unattributedOrders: unattributed, ordersMissingCost: missingCost };
}

// Account-level duplicate check per day, from DUPLICATE_START on (Omar's rule: measured from 14 Oct 2026).
export const DUPLICATE_START = "2026-10-14";

export async function getDailyChecks(shop: string, toKey: string): Promise<DayCheck[]> {
  const fromKey = DUPLICATE_START;
  if (toKey < fromKey) return [];
  const [insights, orders] = await Promise.all([
    db.metaInsightsDaily.groupBy({
      by: ["date"],
      where: { shop, level: "AD", attributionWindow: WINDOW, date: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKey}T00:00:00Z`) } },
      _sum: { metaPurchases: true },
    }),
    db.order.findMany({
      where: { shop, createdAtShopify: { gte: new Date(`${shiftDay(fromKey, -1)}T00:00:00Z`), lt: new Date(`${shiftDay(toKey, 2)}T00:00:00Z`) } },
      select: { createdAtShopify: true },
    }),
  ]);
  const meta: Record<string, number> = {};
  for (const r of insights) meta[r.date.toISOString().slice(0, 10)] = r._sum.metaPurchases ?? 0;
  const shopify: Record<string, number> = {};
  for (const o of orders) {
    const d = dayKey(o.createdAtShopify);
    shopify[d] = (shopify[d] ?? 0) + 1;
  }
  return dayChecks(meta, shopify, fromKey, toKey);
}
