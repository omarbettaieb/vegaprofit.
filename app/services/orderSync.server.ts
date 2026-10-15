import { Prisma } from "@prisma/client";
import db from "../db.server";
import { findPossibleDuplicates } from "../lib/duplicates.ts";
import { ORDERS_PAGE_SIZE, ORDERS_QUERY, ORDER_BY_ID_QUERY } from "../lib/orderQuery.ts";
import { normalizeOrder } from "../lib/normalize.ts";
import type { NormalizedOrder, ShopifyOrderNode } from "../lib/normalize.ts";
import { mergeSettings } from "../lib/settings.ts";
import type { Settings } from "../lib/settings.ts";
import { adminQuery } from "./shopifyGraphql.server";
import type { AdminLike } from "./shopifyGraphql.server";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Settings + small key/value helpers (Setting table)
// ---------------------------------------------------------------------------
export async function getSettings(shop: string): Promise<Settings> {
  const rows = await db.setting.findMany({ where: { shop } });
  return mergeSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

async function ensureShop(shop: string) {
  await db.shop.upsert({ where: { shop }, create: { shop }, update: {} });
}

async function setSetting(shop: string, key: string, value: Prisma.InputJsonValue) {
  await ensureShop(shop);
  await db.setting.upsert({
    where: { shop_key: { shop, key } },
    create: { shop, key, value },
    update: { value },
  });
}

async function getSetting<T>(shop: string, key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { shop_key: { shop, key } } });
  return (row?.value as T | undefined) ?? null;
}

function getHashSecret(): string {
  const s = process.env.PII_HASH_SECRET || process.env.SHOPIFY_API_SECRET || "";
  if (!s) throw new Error("Set PII_HASH_SECRET (or SHOPIFY_API_SECRET) in .env: phone hashes need a secret.");
  return s;
}

// ---------------------------------------------------------------------------
// Idempotent upsert of one normalized order (+ lines, refunds, attribution, status history)
// ---------------------------------------------------------------------------
const FIELD_LEVEL = { campaign: "CAMPAIGN", term: "ADSET", content: "AD" } as const;

export async function upsertNormalizedOrder(
  shop: string,
  n: NormalizedOrder,
  source: string,
): Promise<{ created: boolean; changed: boolean }> {
  await ensureShop(shop);

  return db.$transaction(
    async (tx) => {
      const existing = await tx.order.findUnique({
        where: { shop_shopifyOrderId: { shop, shopifyOrderId: n.shopifyOrderId } },
        select: { id: true, lifecycle: true, paidAt: true },
      });

      // NOTE: `excluded`, `excludedReason` and `possibleDuplicateOf` are deliberately absent:
      // a re-sync must never overwrite Omar's manual decisions.
      const data = {
        name: n.name,
        createdAtShopify: n.createdAtShopify,
        cancelledAt: n.cancelledAt,
        cancelReason: n.cancelReason,
        financialStatus: n.financialStatus,
        fulfillmentStatus: n.fulfillmentStatus,
        fulfilledAt: n.fulfilledAt,
        lifecycle: n.lifecycle,
        currency: n.currency,
        totalPrice: n.totalPrice,
        totalRefunded: n.totalRefunded,
        shippingPrice: n.shippingPrice,
        discountTotal: n.discountTotal,
        phoneHash: n.phoneHash,
        emailHash: n.emailHash,
        customerId: n.customerId,
        tags: n.tags,
        rawUtm: n.rawUtm ? ({ ...n.rawUtm } as Prisma.InputJsonObject) : Prisma.JsonNull,
        landingUrl: n.landingUrl,
      };
      // First time we observe the order as DELIVERED (PAID), remember when.
      const paidAt = n.lifecycle === "DELIVERED" && !existing?.paidAt ? new Date() : undefined;

      const order = existing
        ? await tx.order.update({ where: { id: existing.id }, data: { ...data, paidAt } })
        : await tx.order.create({ data: { shop, shopifyOrderId: n.shopifyOrderId, ...data, paidAt } });

      // Lines: replace wholesale (Shopify is the source of truth).
      await tx.orderLine.deleteMany({ where: { orderId: order.id } });
      if (n.lines.length > 0) {
        await tx.orderLine.createMany({
          data: n.lines.map((l) => ({ shop, orderId: order.id, ...l })),
        });
      }

      for (const r of n.refunds) {
        await tx.refund.upsert({
          where: { shop_shopifyRefundId: { shop, shopifyRefundId: r.shopifyRefundId } },
          create: { shop, orderId: order.id, ...r },
          update: { amount: r.amount, note: r.note, refundedAt: r.refundedAt },
        });
      }

      // Attribution: ids from UTMs/URL; names resolved through the editable UtmNameMap.
      const attr = { ...n.attribution };
      let usedNameMap = false;
      for (const u of n.unresolved) {
        const hit = await tx.utmNameMap.findUnique({
          where: { shop_field_utmValue: { shop, field: u.field, utmValue: u.value } },
        });
        if (!hit) continue;
        const level = FIELD_LEVEL[u.field];
        if (level === "CAMPAIGN" && !attr.campaignId) attr.campaignId = hit.metaId;
        else if (level === "ADSET" && !attr.adSetId) attr.adSetId = hit.metaId;
        else if (level === "AD" && !attr.adId) attr.adId = hit.metaId;
        else continue;
        usedNameMap = true;
      }
      if (usedNameMap && attr.method === "NONE") attr.method = "NAME_MAP";

      await tx.orderAttribution.upsert({
        where: { orderId: order.id },
        create: { shop, orderId: order.id, ...attr },
        update: { ...attr, resolvedAt: new Date() },
      });

      // Status history: first sighting, then every lifecycle change.
      let changed = false;
      if (!existing) {
        await tx.orderStatusHistory.create({
          data: { shop, orderId: order.id, fromStatus: null, toStatus: n.lifecycle, source },
        });
      } else if (existing.lifecycle !== n.lifecycle) {
        changed = true;
        await tx.orderStatusHistory.create({
          data: { shop, orderId: order.id, fromStatus: existing.lifecycle, toStatus: n.lifecycle, source },
        });
      }
      return { created: !existing, changed };
    },
    { timeout: 30_000 },
  );
}

// ---------------------------------------------------------------------------
// Possible-duplicate flags (flag only; never deletes or excludes)
// ---------------------------------------------------------------------------
export async function recomputeDuplicateFlags(shop: string, settings: Settings, since?: Date) {
  const rows = await db.order.findMany({
    where: { shop, ...(since ? { createdAtShopify: { gte: since } } : {}) },
    select: { id: true, createdAtShopify: true, phoneHash: true, excluded: true, possibleDuplicateOf: true },
  });
  const flags = findPossibleDuplicates(
    rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAtShopify,
      phoneHash: r.phoneHash,
      excluded: r.excluded,
    })),
    settings.duplicate_window_hours,
  );
  const updates = rows
    .filter((r) => (flags.get(r.id) ?? null) !== r.possibleDuplicateOf)
    .map((r) =>
      db.order.update({ where: { id: r.id }, data: { possibleDuplicateOf: flags.get(r.id) ?? null } }),
    );
  if (updates.length > 0) await db.$transaction(updates);
}

function duplicateWindowStart(settings: Settings): Date {
  return new Date(Date.now() - (settings.recheck_days + settings.duplicate_window_hours / 24 + 1) * DAY_MS);
}

// ---------------------------------------------------------------------------
// Fetching: one order (webhooks) and many (import / re-check)
// ---------------------------------------------------------------------------
export async function syncOrderByGid(admin: AdminLike, shop: string, gid: string, source: string) {
  const data = await adminQuery<{ order: ShopifyOrderNode | null }>(admin, ORDER_BY_ID_QUERY, { id: gid });
  if (!data.order) return { found: false as const };
  const result = await upsertNormalizedOrder(shop, normalizeOrder(data.order, getHashSecret()), source);
  const settings = await getSettings(shop);
  await recomputeDuplicateFlags(shop, settings, duplicateWindowStart(settings));
  return { found: true as const, ...result };
}

export async function importOrders(
  admin: AdminLike,
  shop: string,
  opts: {
    sinceDays?: number; // omit for the full history
    source: string;
    onProgress?: (p: { processed: number; created: number; changed: number }) => Promise<void> | void;
  },
) {
  const secret = getHashSecret();
  const search = opts.sinceDays
    ? `updated_at:>=${new Date(Date.now() - opts.sinceDays * DAY_MS).toISOString()}`
    : undefined;

  let after: string | null = null;
  let processed = 0;
  let created = 0;
  let changed = 0;

  for (;;) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrderNode[] } } =
      await adminQuery(admin, ORDERS_QUERY, { first: ORDERS_PAGE_SIZE, after, query: search });
    for (const node of data.orders.nodes) {
      const r = await upsertNormalizedOrder(shop, normalizeOrder(node, secret), opts.source);
      processed++;
      if (r.created) created++;
      if (r.changed) changed++;
    }
    await opts.onProgress?.({ processed, created, changed });
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }

  const settings = await getSettings(shop);
  await recomputeDuplicateFlags(shop, settings, opts.sinceDays ? duplicateWindowStart(settings) : undefined);
  return { processed, created, changed };
}

// ---------------------------------------------------------------------------
// Background runs with a persisted status (shown on the Sync page)
// ---------------------------------------------------------------------------
export interface SyncStatus {
  state: "idle" | "running" | "error";
  mode: "full" | "recheck" | null;
  startedAt: string | null;
  finishedAt: string | null;
  processed: number;
  created: number;
  changed: number;
  error: string | null;
}

const EMPTY_STATUS: SyncStatus = {
  state: "idle",
  mode: null,
  startedAt: null,
  finishedAt: null,
  processed: 0,
  created: 0,
  changed: 0,
  error: null,
};

const runningShops = new Set<string>();

export async function getSyncStatus(shop: string): Promise<SyncStatus> {
  const s = (await getSetting<SyncStatus>(shop, "sync_status")) ?? EMPTY_STATUS;
  if (s.state === "running" && !runningShops.has(shop)) {
    return { ...s, state: "error", error: "Interrupted (the server restarted). Run it again." };
  }
  return s;
}

const saveStatus = (shop: string, s: SyncStatus) =>
  setSetting(shop, "sync_status", s as unknown as Prisma.InputJsonObject);

// Starts a sync in the background and returns immediately. False when one is already running.
export function startSync(admin: AdminLike, shop: string, mode: "full" | "recheck", source: string): boolean {
  if (runningShops.has(shop)) return false;
  runningShops.add(shop);
  void runSync(admin, shop, mode, source).finally(() => runningShops.delete(shop));
  return true;
}

async function runSync(admin: AdminLike, shop: string, mode: "full" | "recheck", source: string) {
  let status: SyncStatus = { ...EMPTY_STATUS, state: "running", mode, startedAt: new Date().toISOString() };
  try {
    await saveStatus(shop, status);
    const settings = await getSettings(shop);
    const result = await importOrders(admin, shop, {
      sinceDays: mode === "recheck" ? settings.recheck_days : undefined,
      source,
      onProgress: async (p) => {
        status = { ...status, ...p };
        await saveStatus(shop, status);
      },
    });
    status = { ...status, ...result, state: "idle", finishedAt: new Date().toISOString() };
    await setSetting(shop, "last_recheck_at", new Date().toISOString());
    if (mode === "full") await db.shop.update({ where: { shop }, data: { lastFullSyncAt: new Date() } });
  } catch (e) {
    console.error(`[sync] ${mode} failed for ${shop}`, e);
    status = {
      ...status,
      state: "error",
      finishedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
  await saveStatus(shop, status);
}

// Catch-up on app open: reversals arrive days after an order and webhooks can be missed
// (laptop asleep, free host sleeping), so re-check recent orders when the last check is stale.
// Does nothing until the first import has completed.
export async function catchUpIfDue(admin: AdminLike, shop: string): Promise<boolean> {
  const last = await getSetting<string>(shop, "last_recheck_at");
  if (!last) return false;
  const settings = await getSettings(shop);
  const ageHours = (Date.now() - new Date(last).getTime()) / 3_600_000;
  if (ageHours < settings.recheck_interval_hours) return false;
  return startSync(admin, shop, "recheck", "catch_up");
}

// ---------------------------------------------------------------------------
// Manual exclusion (fake / test / spam). Never automatic.
// ---------------------------------------------------------------------------
export async function setExcluded(shop: string, orderId: string, excluded: boolean, reason = "fake") {
  await db.order.updateMany({
    where: { id: orderId, shop },
    data: { excluded, excludedReason: excluded ? reason : null },
  });
  const settings = await getSettings(shop);
  await recomputeDuplicateFlags(shop, settings, duplicateWindowStart(settings));
}
