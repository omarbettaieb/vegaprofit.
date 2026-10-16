import { Prisma } from "@prisma/client";
import db from "../db.server";
import { cpa, parseInsightRow } from "../lib/meta.ts";
import type { GraphInsightRow, InsightRow, MetaLine } from "../lib/meta.ts";
import { dayKey, shiftDay } from "../lib/profit.ts";
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

// Spend, Meta-reported purchases and Shopify orders per campaign / ad set / ad for a day range.
// "True orders" = Shopify orders attributed to the entity that are not cancelled, returned or refunded.
export async function getMetaLines(shop: string, level: MetaLevelName, fromKey: string, toKey: string): Promise<{ lines: MetaLine[]; rate: number; unattributedOrders: number }> {
  const settings = await getSettings(shop);
  const rate = settings.fx_usd_tnd;
  const from = new Date(`${fromKey}T00:00:00Z`);
  const to = new Date(`${toKey}T00:00:00Z`);

  const [insights, ads, adSets, campaigns, orders] = await Promise.all([
    db.metaInsightsDaily.findMany({ where: { shop, level: "AD", attributionWindow: WINDOW, date: { gte: from, lte: to } } }),
    db.metaAd.findMany({ where: { shop }, select: { metaId: true, name: true, adSet: { select: { metaId: true } } } }),
    db.metaAdSet.findMany({ where: { shop }, select: { metaId: true, name: true, campaign: { select: { metaId: true } } } }),
    db.metaCampaign.findMany({ where: { shop }, select: { metaId: true, name: true } }),
    db.order.findMany({
      where: {
        shop,
        excluded: false,
        createdAtShopify: { gte: new Date(`${shiftDay(fromKey, -1)}T00:00:00Z`), lt: new Date(`${shiftDay(toKey, 2)}T00:00:00Z`) },
      },
      select: { createdAtShopify: true, lifecycle: true, totalPrice: true, totalRefunded: true, attribution: { select: { campaignId: true, adSetId: true, adId: true } } },
    }),
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

  const acc = new Map<string, { spend: number; purchases: number; clicks: number; impressions: number; orders: number; revenue: number }>();
  const slot = (k: string) => {
    let v = acc.get(k);
    if (!v) acc.set(k, (v = { spend: 0, purchases: 0, clicks: 0, impressions: 0, orders: 0, revenue: 0 }));
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

  let unattributed = 0;
  for (const o of orders) {
    const day = dayKey(o.createdAtShopify);
    if (day < fromKey || day > toKey) continue;
    if (o.lifecycle === "CANCELLED" || o.lifecycle === "RETURNED" || o.lifecycle === "REFUNDED") continue;
    const a = o.attribution;
    const k = level === "campaign" ? a?.campaignId : level === "adset" ? a?.adSetId : a?.adId;
    if (!k) {
      unattributed += 1;
      continue;
    }
    const v = slot(k);
    v.orders += 1;
    v.revenue += Number(o.totalPrice) - Number(o.totalRefunded);
  }

  const lines: MetaLine[] = [...acc.entries()].map(([key, v]) => ({
    key,
    name: names.get(key) ?? key,
    parent: level === "campaign" ? undefined : parentName.get(key),
    spendTnd: v.spend,
    metaPurchases: v.purchases,
    clicks: v.clicks,
    impressions: v.impressions,
    trueOrders: v.orders,
    revenueTnd: v.revenue,
    cpaTnd: cpa(v.spend, v.orders),
    metaCpaTnd: cpa(v.spend, v.purchases),
  }));
  lines.sort((a, b) => b.spendTnd - a.spendTnd);
  return { lines, rate, unattributedOrders: unattributed };
}
