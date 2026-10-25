import db from "../db.server";
import { dayKey, shiftDay } from "../lib/profit.ts";
import { adminQuery } from "./shopifyGraphql.server";
import type { AdminLike } from "./shopifyGraphql.server";
import { getSettings, getSyncStatus } from "./orderSync.server";
import { getMetaStatus, metaConfig } from "./meta.server";

export type Level = "ok" | "warn" | "fail";
export interface Check {
  name: string;
  level: Level;
  detail: string;
  fix?: string;
}

const hoursAgo = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : null);
const fmtAge = (h: number | null) => (h === null ? "never" : h < 1 ? "under an hour ago" : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`);

async function metaTokenCheck(): Promise<Check> {
  const cfg = metaConfig();
  if (!cfg) {
    return { name: "Meta connection", level: "fail", detail: "META_ACCESS_TOKEN or META_AD_ACCOUNT_ID is not set.", fix: "Add both in Render, Environment, then redeploy." };
  }
  try {
    const url = `https://graph.facebook.com/${cfg.version}/act_${cfg.adAccountId}?fields=name,account_status,currency&access_token=${encodeURIComponent(cfg.token)}`;
    const res = await fetch(url);
    const body = (await res.json()) as { name?: string; account_status?: number; currency?: string; error?: { message?: string; code?: number } };
    if (!res.ok || body.error) {
      return { name: "Meta connection", level: "fail", detail: `Meta refused the token: ${body.error?.message ?? res.statusText} (code ${body.error?.code ?? res.status}).`, fix: "Generate a new system-user token with ads_read and replace META_ACCESS_TOKEN in Render." };
    }
    const active = body.account_status === 1;
    return {
      name: "Meta connection",
      level: active ? "ok" : "warn",
      detail: `Token works. Ad account "${body.name}" in ${body.currency}${active ? "" : `, status code ${body.account_status} (not active)`}.`,
      fix: active ? undefined : "Check the ad account in Meta Business settings (billing or restriction).",
    };
  } catch (e) {
    return { name: "Meta connection", level: "warn", detail: `Could not reach Meta: ${e instanceof Error ? e.message : "network error"}.` };
  }
}

export async function runHealth(admin: AdminLike, shop: string): Promise<Check[]> {
  const checks: Check[] = [];
  const settings = await getSettings(shop);
  const today = dayKey(new Date());
  const since = new Date(`${shiftDay(today, -59)}T00:00:00Z`);

  // Database + order coverage
  try {
    const [dbCount, excluded, oldest] = await Promise.all([
      db.order.count({ where: { shop, createdAtShopify: { gte: since } } }),
      db.order.count({ where: { shop, createdAtShopify: { gte: since }, excluded: true } }),
      db.order.findFirst({ where: { shop }, orderBy: { createdAtShopify: "asc" }, select: { createdAtShopify: true } }),
    ]);
    let shopifyCount: number | null = null;
    try {
      const data = await adminQuery<{ ordersCount: { count: number } }>(
        admin,
        `query($q:String){ ordersCount(query:$q){ count } }`,
        { q: `created_at:>=${shiftDay(today, -59)}` },
      );
      shopifyCount = data.ordersCount.count;
    } catch {
      shopifyCount = null;
    }
    if (shopifyCount === null) {
      checks.push({ name: "Orders imported", level: "warn", detail: `${dbCount} orders in the last 60 days stored here. Could not read Shopify's count.` });
    } else if (shopifyCount === dbCount) {
      checks.push({ name: "Orders imported", level: "ok", detail: `${dbCount} of ${shopifyCount} orders from the last 60 days are stored (${excluded} marked fake).` });
    } else {
      checks.push({
        name: "Orders imported",
        level: "warn",
        detail: `Shopify has ${shopifyCount} orders in the last 60 days, this app has ${dbCount}.`,
        fix: "Open Orders sync and press Import all orders.",
      });
    }
    checks.push({
      name: "Order history depth",
      level: "ok",
      detail: oldest ? `Oldest stored order: ${dayKey(oldest.createdAtShopify)}. The app sees the last 60 days because Shopify has not granted read_all_orders.` : "No orders stored yet.",
    });
  } catch (e) {
    checks.push({ name: "Database", level: "fail", detail: `Database error: ${e instanceof Error ? e.message : "unknown"}.`, fix: "Check the Neon database and DATABASE_URL in Render." });
  }

  // Order re-check
  const sync = await getSyncStatus(shop);
  const lastCheck = await db.setting.findUnique({ where: { shop_key: { shop, key: "last_recheck_at" } } });
  const checkAge = hoursAgo((lastCheck?.value as string | undefined) ?? null);
  if (sync.state === "error") {
    checks.push({ name: "Order re-check", level: "fail", detail: `Last run failed: ${sync.error ?? "unknown error"}.`, fix: "Open Orders sync and run it again." });
  } else if (checkAge === null) {
    checks.push({ name: "Order re-check", level: "warn", detail: "Has never run.", fix: "Open Orders sync and press Import all orders." });
  } else {
    checks.push({ name: "Order re-check", level: checkAge > 48 ? "warn" : "ok", detail: `Last cancellations/returns check: ${fmtAge(checkAge)}. It runs when you open the app and the last run is older than ${settings.recheck_interval_hours} h.` });
  }

  // Meta
  checks.push(await metaTokenCheck());
  const meta = await getMetaStatus(shop);
  if (meta.configured) {
    const age = hoursAgo(meta.lastSyncAt);
    const latest = await db.metaInsightsDaily.findFirst({ where: { shop }, orderBy: { date: "desc" }, select: { date: true } });
    checks.push({
      name: "Meta spend data",
      level: meta.error ? "fail" : age === null ? "warn" : age > 36 ? "warn" : "ok",
      detail: meta.error
        ? `Last sync failed: ${meta.error}`
        : `Last sync ${fmtAge(age)}. Newest day stored: ${latest ? latest.date.toISOString().slice(0, 10) : "none"}.`,
      fix: meta.error || age === null || age > 36 ? "Open Meta ads and press Sync Meta now." : undefined,
    });
  }

  // Money settings
  checks.push(
    settings.fx_usd_tnd > 0
      ? { name: "USD to TND rate", level: "ok", detail: `1 USD = ${settings.fx_usd_tnd} TND.` }
      : { name: "USD to TND rate", level: "fail", detail: "Not set, so every ad spend figure is 0.", fix: "Costs page, Meta exchange rate." },
  );
  checks.push(
    settings.fee_out > 0
      ? { name: "Delivery fee", level: "ok", detail: `${settings.fee_out} TND per parcel, ${settings.fee_return} TND extra when returned.` }
      : { name: "Delivery fee", level: "fail", detail: "Fee is 0, so profit and break-even are overstated.", fix: "Costs page, Delivery fees." },
  );
  const [variants, costed] = await Promise.all([
    db.orderLine.findMany({ where: { shop, variantId: { not: null } }, distinct: ["variantId"], select: { variantId: true } }),
    db.productVariantCost.findMany({ where: { shop }, distinct: ["variantId"], select: { variantId: true } }),
  ]);
  const costedSet = new Set(costed.map((c) => c.variantId));
  const missing = variants.filter((v) => !costedSet.has(v.variantId as string)).length;
  checks.push(
    missing === 0
      ? { name: "Product costs", level: "ok", detail: `All ${variants.length} products sold have a cost.` }
      : { name: "Product costs", level: "warn", detail: `${missing} of ${variants.length} products have no cost, so their profit is overstated.`, fix: "Costs page, Product costs." },
  );

  // Attribution coverage on live orders of the last 30 days
  const from30 = new Date(`${shiftDay(today, -29)}T00:00:00Z`);
  const [live, tracked] = await Promise.all([
    db.order.count({ where: { shop, excluded: false, createdAtShopify: { gte: from30 }, lifecycle: { notIn: ["CANCELLED", "RETURNED", "REFUNDED"] } } }),
    db.order.count({
      where: { shop, excluded: false, createdAtShopify: { gte: from30 }, lifecycle: { notIn: ["CANCELLED", "RETURNED", "REFUNDED"] }, attribution: { campaignId: { not: null } } },
    }),
  ]);
  if (live > 0) {
    const pct = Math.round((tracked / live) * 100);
    checks.push({
      name: "Orders tied to an ad",
      level: pct >= 60 ? "ok" : "warn",
      detail: `${tracked} of ${live} active orders in the last 30 days (${pct}%) carry a Meta campaign. The rest are direct, organic, or arrived without tracking data.`,
      fix: pct >= 60 ? undefined : "Check that your Meta ad URLs keep the campaign, ad set and ad IDs in the UTM parameters.",
    });
  }

  // Calendar
  const dueReviews = await db.reviewCalendarEvent.count({ where: { shop, done: false, date: { lte: new Date(`${today}T00:00:00Z`) } } });
  checks.push(
    dueReviews > 0
      ? { name: "Calendar", level: "warn", detail: `${dueReviews} calendar item(s) are due today or overdue.`, fix: "Open the Calendar and mark them done." }
      : { name: "Calendar", level: "ok", detail: "Nothing overdue." },
  );
  return checks;
}
