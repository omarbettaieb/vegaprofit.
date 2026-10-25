import type { TrackingStatus } from "./truth.ts";

// Decision engine (pure). One verdict per campaign / ad set / ad.
// Thresholds are multiples of break-even CPA (average profit one true order leaves before ads).
//
// Order of precedence:
//   1. CALENDAR  learning window (days 1-3): no edits
//   2. WATCH     no break-even number yet: nothing to judge against
//   3. KILL      spend >= 2x break-even with 0 true orders, or >= 10 orders and CPA > 1.5x
//   4. PAUSE     early rule (spend > 3x and CPA > 2x), or tracking RED
//   5. CALENDAR  seasonal window, planned end very close, or a review date set by you
//   6. PAUSE     >= 10 orders and CPA 1.2x - 1.5x
//   7. SCALE     >= 10 orders, CPA <= 0.8x, tracking not RED, reversal rate not rising (+20%, once per 48h)
//   8. WATCH     everything else

export type VerdictName = "KILL" | "PAUSE" | "WATCH" | "CALENDAR" | "SCALE";

export interface VerdictRules {
  min_orders: number;
  kill_zero_mult: number;
  kill_cpa_mult: number;
  pause_cpa_mult: number;
  scale_cpa_mult: number;
  early_spend_mult: number;
  early_cpa_mult: number;
  learning_days: number;
  scale_step_pct: number;
  scale_cooldown_hours: number;
  end_soon_days: number;
  reversal_rise_points: number; // 0.15 = reversal rate up by 15 points
}

export const DEFAULT_RULES: VerdictRules = {
  min_orders: 10,
  kill_zero_mult: 2,
  kill_cpa_mult: 1.5,
  pause_cpa_mult: 1.2,
  scale_cpa_mult: 0.8,
  early_spend_mult: 3,
  early_cpa_mult: 2,
  learning_days: 3,
  scale_step_pct: 20,
  scale_cooldown_hours: 48,
  end_soon_days: 3,
  reversal_rise_points: 0.15,
};

export interface VerdictInput {
  spend: number; // TND, in the judging window
  trueOrders: number;
  trueCpa: number | null;
  breakEven: number | null; // this entity
  referenceBreakEven: number | null; // account-wide fallback
  tracking: TrackingStatus;
  daysLive: number; // 1 = first day of spend
  recentReversalRate: number | null; // last 7 days, 0..1
  priorReversalRate: number | null; // the 7 days before
  recentShopifyOrders: number;
  plannedEnd: string | null; // YYYY-MM-DD (own date, or inherited from the campaign)
  seasonalUntil: string | null; // active seasonal window end
  reviewDate: string | null; // next review chosen by you (today or later)
  lastScaleSuggestedAt: Date | null;
  today: string; // YYYY-MM-DD, shop timezone
  now: Date;
}

export interface VerdictResult {
  verdict: VerdictName;
  reason: string;
  nextReview: string | null;
  scaleSuggestion: string | null;
  cpaMultiple: number | null; // true CPA / break-even
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
}

function addDays(key: string, n: number): string {
  return new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) + n * 86_400_000).toISOString().slice(0, 10);
}

const x = (n: number) => `${n.toFixed(2)}x`;

export function decide(i: VerdictInput, r: VerdictRules = DEFAULT_RULES): VerdictResult {
  const be = i.breakEven ?? i.referenceBreakEven;
  const mult = i.trueCpa !== null && be ? i.trueCpa / be : null;
  const spendMult = be ? i.spend / be : null;
  const out = (verdict: VerdictName, reason: string, nextReview: string | null = null, scaleSuggestion: string | null = null): VerdictResult => ({
    verdict,
    reason,
    nextReview,
    scaleSuggestion,
    cpaMultiple: mult,
  });

  if (i.daysLive <= r.learning_days) {
    return out("CALENDAR", `Learning window: day ${i.daysLive} of ${r.learning_days}. Do not edit it yet.`, addDays(i.today, r.learning_days - i.daysLive + 1));
  }
  if (!be) {
    return out("WATCH", "No break-even number yet. Enter product costs and the delivery fee so the app has something to judge against.");
  }

  if (i.trueOrders === 0 && spendMult !== null && spendMult >= r.kill_zero_mult) {
    return out("KILL", `Spent ${x(spendMult)} the break-even cost with 0 true orders (limit ${x(r.kill_zero_mult)}).`);
  }
  if (i.trueOrders >= r.min_orders && mult !== null && mult > r.kill_cpa_mult) {
    return out("KILL", `${i.trueOrders} true orders at ${x(mult)} the break-even cost (limit ${x(r.kill_cpa_mult)}).`);
  }

  if (spendMult !== null && mult !== null && spendMult > r.early_spend_mult && mult > r.early_cpa_mult) {
    return out("PAUSE", `Early stop: spent ${x(spendMult)} break-even and each order costs ${x(mult)} (limits ${x(r.early_spend_mult)} and ${x(r.early_cpa_mult)}).`);
  }
  if (i.tracking === "RED") {
    return out("PAUSE", "Tracking is broken: Meta reports far more purchases than Shopify has orders. Fix tracking before trusting this ad.");
  }

  if (i.seasonalUntil) {
    return out("CALENDAR", `Seasonal window until ${i.seasonalUntil}. Judge it after the window.`, i.seasonalUntil);
  }
  if (i.plannedEnd) {
    const left = daysBetween(i.today, i.plannedEnd);
    if (left >= 0 && left <= r.end_soon_days) {
      return out("CALENDAR", `Ends on ${i.plannedEnd} (${left} day(s) left). Let it finish, do not scale.`, i.plannedEnd);
    }
  }
  if (i.reviewDate && i.reviewDate >= i.today) {
    return out("CALENDAR", `You set a review for ${i.reviewDate}. No decision until then.`, i.reviewDate);
  }

  if (i.trueOrders >= r.min_orders && mult !== null && mult > r.pause_cpa_mult) {
    return out("PAUSE", `${i.trueOrders} true orders at ${x(mult)} the break-even cost (pause above ${x(r.pause_cpa_mult)}, kill above ${x(r.kill_cpa_mult)}).`);
  }

  if (i.trueOrders >= r.min_orders && mult !== null && mult <= r.scale_cpa_mult) {
    const rising =
      i.recentReversalRate !== null &&
      i.priorReversalRate !== null &&
      i.recentShopifyOrders >= 3 &&
      i.recentReversalRate - i.priorReversalRate > r.reversal_rise_points;
    if (rising) {
      return out("WATCH", `Cost per order is good (${x(mult)}), but the reversal rate is rising (${Math.round(i.priorReversalRate! * 100)}% to ${Math.round(i.recentReversalRate! * 100)}%). Do not scale yet.`);
    }
    const hoursSince = i.lastScaleSuggestedAt ? (i.now.getTime() - i.lastScaleSuggestedAt.getTime()) / 3_600_000 : Infinity;
    if (hoursSince < r.scale_cooldown_hours) {
      const wait = Math.ceil(r.scale_cooldown_hours - hoursSince);
      return out("SCALE", `${i.trueOrders} true orders at ${x(mult)} the break-even cost. A +${r.scale_step_pct}% raise was already suggested, wait about ${wait}h before the next one.`);
    }
    return out("SCALE", `${i.trueOrders} true orders at ${x(mult)} the break-even cost, tracking is fine.`, null, `Raise the daily budget by ${r.scale_step_pct}%, then leave it for ${r.scale_cooldown_hours}h.`);
  }

  if (i.trueOrders < r.min_orders) {
    return out("WATCH", `Only ${i.trueOrders} true order(s), the app wants ${r.min_orders} before judging${mult !== null ? ` (cost per order so far ${x(mult)} break-even)` : ""}.`);
  }
  return out("WATCH", `${i.trueOrders} true orders at ${x(mult ?? 0)} the break-even cost: inside the hold range (${x(r.scale_cpa_mult)} to ${x(r.pause_cpa_mult)}).`);
}
