// Truth layer (pure). Compares what Meta says it sold with what Shopify can prove.
//
// For one campaign / ad set / ad:
//   metaPurchases   what Meta reports
//   shopifyOrders   all Shopify orders tied to the entity (any status), plus excluded (fake) ones
//   reversed        of those, cancelled / returned / refunded
//   excluded        of those, orders you marked fake
//   trueOrders      shopifyOrders - reversed - excluded (real, still standing)
//   unexplained     Meta purchases with no Shopify order behind them (duplicates, view-only credit,
//                   or orders that arrived without tracking data)

export type TrackingStatus = "GREEN" | "AMBER" | "RED" | "LOW";

export interface TruthInput {
  metaPurchases: number;
  trueOrders: number;
  reversedOrders: number;
  excludedOrders: number;
  spend: number; // TND
  revenue: number; // TND, true orders only
  contribution: number; // TND, sum of profit before ads of the entity's orders (returned parcels count negative)
}

export interface Truth {
  shopifyOrders: number;
  unexplained: number;
  inflationPct: number | null; // how much Meta over-reports vs the Shopify orders behind it
  trackingStatus: TrackingStatus;
  trueCpa: number | null;
  metaCpa: number | null;
  breakEvenCpa: number | null; // average contribution per true order
  trueRoas: number | null;
  breakEvenRoas: number | null;
  cpaVsBreakEven: number | null; // trueCpa / breakEvenCpa
}

export interface TrackingLimits {
  amberRatio: number; // Meta / Shopify orders above this => AMBER
  redRatio: number; // above this => RED
  minPurchases: number; // fewer Meta purchases than this => LOW (not enough data)
}

export const DEFAULT_LIMITS: TrackingLimits = { amberRatio: 1.25, redRatio: 1.75, minPurchases: 4 };

export function trackingStatus(metaPurchases: number, shopifyOrders: number, limits: TrackingLimits = DEFAULT_LIMITS): TrackingStatus {
  if (metaPurchases < limits.minPurchases && shopifyOrders < limits.minPurchases) return "LOW";
  if (shopifyOrders === 0) return metaPurchases >= limits.minPurchases ? "RED" : "LOW";
  const ratio = metaPurchases / shopifyOrders;
  if (ratio > limits.redRatio) return "RED";
  if (ratio > limits.amberRatio) return "AMBER";
  return "GREEN";
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function computeTruth(t: TruthInput, limits: TrackingLimits = DEFAULT_LIMITS): Truth {
  const shopifyOrders = t.trueOrders + t.reversedOrders + t.excludedOrders;
  const unexplained = Math.max(0, t.metaPurchases - shopifyOrders);
  const trueCpa = div(t.spend, t.trueOrders);
  const breakEvenCpa = t.trueOrders > 0 && t.contribution > 0 ? t.contribution / t.trueOrders : null;
  return {
    shopifyOrders,
    unexplained,
    inflationPct: shopifyOrders > 0 ? ((t.metaPurchases - shopifyOrders) / shopifyOrders) * 100 : null,
    trackingStatus: trackingStatus(t.metaPurchases, shopifyOrders, limits),
    trueCpa,
    metaCpa: div(t.spend, t.metaPurchases),
    breakEvenCpa,
    trueRoas: div(t.revenue, t.spend),
    breakEvenRoas: t.contribution > 0 ? div(t.revenue, t.contribution) : null,
    cpaVsBreakEven: trueCpa !== null && breakEvenCpa !== null ? trueCpa / breakEvenCpa : null,
  };
}

export interface DayCheck {
  date: string;
  metaPurchases: number;
  shopifyOrders: number; // every order created that day, any status, any source
  duplicates: number; // Meta cannot have more purchases than orders exist
}

// Account-level duplicate check: a purchase needs an order behind it, so any excess is certainly duplicated.
export function dayChecks(meta: Record<string, number>, orders: Record<string, number>, fromKey: string, toKey: string): DayCheck[] {
  const keys = new Set([...Object.keys(meta), ...Object.keys(orders)]);
  return [...keys]
    .filter((k) => k >= fromKey && k <= toKey)
    .sort()
    .map((date) => {
      const m = meta[date] ?? 0;
      const s = orders[date] ?? 0;
      return { date, metaPurchases: m, shopifyOrders: s, duplicates: Math.max(0, m - s) };
    });
}
