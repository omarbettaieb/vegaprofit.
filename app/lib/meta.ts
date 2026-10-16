// Pure helpers for Meta Marketing API insights (no database, no network).
// Spend is stored in the ad account currency (USD) and converted to TND at read time with one typed rate.

export interface GraphAction {
  action_type: string;
  value: string;
}

export interface GraphInsightRow {
  date_start: string; // "YYYY-MM-DD" in the ad account timezone
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  frequency?: string;
  actions?: GraphAction[];
  action_values?: GraphAction[];
}

export interface InsightRow {
  date: string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  adId: string;
  adName: string;
  spend: number; // account currency
  impressions: number;
  clicks: number;
  frequency: number | null;
  purchases: number;
  purchaseValue: number; // account currency
}

// Meta reports the same purchase under several action types. Take only the first one present, never the sum.
const PURCHASE_TYPES = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];

function pick(list: GraphAction[] | undefined): number {
  if (!list) return 0;
  for (const type of PURCHASE_TYPES) {
    const hit = list.find((a) => a.action_type === type);
    if (hit) {
      const n = Number(hit.value);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

export const purchaseCount = (actions?: GraphAction[]) => Math.round(pick(actions));
export const purchaseValue = (values?: GraphAction[]) => pick(values);

const num = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export function parseInsightRow(r: GraphInsightRow): InsightRow | null {
  if (!r.ad_id || !r.adset_id || !r.campaign_id || !/^\d{4}-\d{2}-\d{2}$/.test(r.date_start ?? "")) return null;
  const f = r.frequency === undefined ? null : num(r.frequency);
  return {
    date: r.date_start,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name ?? r.campaign_id,
    adSetId: r.adset_id,
    adSetName: r.adset_name ?? r.adset_id,
    adId: r.ad_id,
    adName: r.ad_name ?? r.ad_id,
    spend: num(r.spend),
    impressions: Math.round(num(r.impressions)),
    clicks: Math.round(num(r.clicks)),
    frequency: f,
    purchases: purchaseCount(r.actions),
    purchaseValue: purchaseValue(r.action_values),
  };
}

export function usdToTnd(amount: number, rate: number): number {
  return amount * rate;
}

// Spend per day in TND, from ad-level rows.
export function spendByDay(rows: { date: string; spend: number }[], rate: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.date] = (out[r.date] ?? 0) + r.spend * rate;
  return out;
}

export interface MetaLine {
  key: string;
  name: string;
  parent?: string;
  spendTnd: number;
  metaPurchases: number;
  clicks: number;
  impressions: number;
  trueOrders: number; // Shopify orders attributed here and not cancelled/returned/refunded
  revenueTnd: number;
  cpaTnd: number | null; // spend / true orders
  metaCpaTnd: number | null; // spend / Meta-reported purchases
}

export function cpa(spend: number, orders: number): number | null {
  return orders > 0 ? spend / orders : null;
}
