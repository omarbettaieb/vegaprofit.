// Fake store for the public demo. Nothing here touches the database or any real shop.
// The numbers are generated (seeded, so they look the same on every visit) and then pushed through the SAME pure
// engines the real app uses: buildReport, computeTruth, decide, reconcile. Only the inputs are made up.
import { buildReport, dayKey, orderProfit, shiftDay } from "./profit.ts";
import type { CostRow, ExpenseRow, ProfitOrder } from "./profit.ts";
import { addOrder, emptyTotals, provisionalShare, reconcile, reversalLag, staleOrders } from "./reconcile.ts";
import type { RecOrder, RecTotals } from "./reconcile.ts";
import { computeTruth, dayChecks, DEFAULT_LIMITS } from "./truth.ts";
import { decide, DEFAULT_RULES } from "./verdict.ts";
import type { VerdictName } from "./verdict.ts";
import type { Lifecycle, View } from "./types.ts";
import type { TruthLine } from "../services/meta.server";
import type { DecisionLine } from "../services/decisions.server";
import type { getReconciliation } from "../services/reconcile.server";
import type { Check } from "../services/health.server";

export const DEMO_STORE = "Atlas Botanics";
export const FX = 3.1; // USD to TND
const FEE_OUT = 8;
const FEE_RETURN = 6;

// ---------- seeded randomness ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- the fictional catalogue ----------

const PRODUCTS = {
  collagen: { name: "Marine Collagen", variant: "v-collagen", price: 89, cost: 31 },
  magnesium: { name: "Magnesium Complex", variant: "v-magnesium", price: 59, cost: 17 },
  omega: { name: "Omega-3 Gold", variant: "v-omega", price: 69, cost: 22 },
  ashwa: { name: "Ashwagandha KSM-66", variant: "v-ashwa", price: 64, cost: 19 },
  pack: { name: "Collagen + Vitamin C Pack", variant: "v-pack", price: 159, cost: 56 },
  whey: { name: "Whey Starter 900 g", variant: "v-whey", price: 119, cost: 66 },
  immunity: { name: "Immunity Bundle", variant: "v-immunity", price: 99, cost: 34 },
} as const;
type ProductKey = keyof typeof PRODUCTS;

interface DAd { id: string; name: string; w: number }
interface DAdSet { id: string; name: string; w: number; ads: DAd[] }
interface DCampaign {
  id: string;
  name: string;
  product: ProductKey;
  dailyUsd: number;
  cpaMult: number; // true cost per order as a share of the nominal margin
  inflation: number; // Meta purchases / Shopify orders behind the ad
  reversal: number; // share of orders that end cancelled or returned
  startAgo: number; // days since the first day of spend
  adSets: DAdSet[];
  plannedEnd?: number; // days from today
  seasonalUntil?: number; // days from today
}

const CAMPAIGNS: DCampaign[] = [
  {
    id: "c1", name: "Collagen · Prospecting", product: "collagen", dailyUsd: 28, cpaMult: 0.8, inflation: 2.3, reversal: 0.2, startAgo: 59,
    adSets: [
      { id: "s1a", name: "Women 25-44 · Tunis", w: 0.6, ads: [{ id: "a1a1", name: "UGC · morning routine", w: 0.6 }, { id: "a1a2", name: "Before and after", w: 0.4 }] },
      { id: "s1b", name: "Broad · all Tunisia", w: 0.4, ads: [{ id: "a1b1", name: "Doctor explains", w: 1 }] },
    ],
  },
  {
    id: "c2", name: "Magnesium Sleep · Prospecting", product: "magnesium", dailyUsd: 26, cpaMult: 0.5, inflation: 1.06, reversal: 0.12, startAgo: 59,
    adSets: [
      { id: "s2a", name: "Interest · wellness", w: 0.55, ads: [{ id: "a2a1", name: "Night routine reel", w: 0.5 }, { id: "a2a2", name: "Static · 3 benefits", w: 0.5 }] },
      { id: "s2b", name: "Lookalike 2% buyers", w: 0.45, ads: [{ id: "a2b1", name: "Night routine reel", w: 1 }] },
    ],
  },
  {
    id: "c3", name: "Omega-3 · Retargeting", product: "omega", dailyUsd: 14, cpaMult: 0.5, inflation: 1.16, reversal: 0.14, startAgo: 59,
    adSets: [{ id: "s3a", name: "Visitors 14 days", w: 1, ads: [{ id: "a3a1", name: "Reminder · free delivery", w: 0.5 }, { id: "a3a2", name: "Review carousel", w: 0.5 }] }],
  },
  {
    id: "c4", name: "Immunity Bundle · Broad", product: "immunity", dailyUsd: 16, cpaMult: 0.95, inflation: 1.3, reversal: 0.19, startAgo: 40,
    adSets: [{ id: "s4a", name: "Broad · 25-55", w: 1, ads: [{ id: "a4a1", name: "Winter is coming", w: 0.6 }, { id: "a4a2", name: "Bundle unboxing", w: 0.4 }] }],
  },
  {
    id: "c5", name: "Whey Starter · Broad", product: "whey", dailyUsd: 40, cpaMult: 1.9, inflation: 1.1, reversal: 0.26, startAgo: 30,
    adSets: [{ id: "s5a", name: "Men 18-34 · gyms", w: 1, ads: [{ id: "a5a1", name: "Gym selfie", w: 0.5 }, { id: "a5a2", name: "Protein facts", w: 0.5 }] }],
  },
  {
    id: "c6", name: "Collagen Pack · Winter Offer", product: "pack", dailyUsd: 20, cpaMult: 0.8, inflation: 1.1, reversal: 0.13, startAgo: 14, seasonalUntil: 9,
    adSets: [{ id: "s6a", name: "Lookalike 1% buyers", w: 1, ads: [{ id: "a6a1", name: "Offer countdown", w: 0.5 }, { id: "a6a2", name: "Pack close-up", w: 0.5 }] }],
  },
  {
    id: "c7", name: "Ashwagandha · Creative test", product: "ashwa", dailyUsd: 12, cpaMult: 0.85, inflation: 1.1, reversal: 0.15, startAgo: 2,
    adSets: [{ id: "s7a", name: "Interest · stress", w: 1, ads: [{ id: "a7a1", name: "Founder story", w: 0.5 }, { id: "a7a2", name: "Calm vs cortisol", w: 0.5 }] }],
  },
];

// ---------- the world ----------

interface DOrder extends RecOrder {
  lines: { variantId: string; quantity: number }[];
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
}
interface DInsight { date: string; campaignId: string; adSetId: string; adId: string; spendUsd: number; purchases: number; valueUsd: number }

export interface World {
  today: string;
  orders: DOrder[];
  insights: DInsight[];
}

let cache: World | null = null;

function build(today: string): World {
  const rnd = mulberry32(20261025);
  const orders: DOrder[] = [];
  const insights: DInsight[] = [];
  const nowMs = Date.parse(`${today}T15:00:00Z`);

  for (let back = 59; back >= 0; back--) {
    const date = shiftDay(today, -back);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const dayFactor = (dow === 5 || dow === 6 ? 1.12 : dow === 1 ? 0.94 : 1) * (0.88 + rnd() * 0.24);
    const partial = back === 0 ? 0.65 : 1;
    const dayOrders: DOrder[] = [];

    for (const c of CAMPAIGNS) {
      if (back > c.startAgo) continue;
      const p = PRODUCTS[c.product];
      const margin = p.price - p.cost - FEE_OUT;
      const ramp = back > c.startAgo - 3 ? 0.55 : 1;
      for (const s of c.adSets) {
        for (const ad of s.ads) {
          const spendUsd = c.dailyUsd * s.w * ad.w * dayFactor * ramp * partial * (0.9 + rnd() * 0.2);
          const trueCpa = margin * c.cpaMult * (0.9 + rnd() * 0.25);
          const expected = (spendUsd * FX) / trueCpa;
          const n = Math.floor(expected + rnd());
          for (let i = 0; i < n; i++) {
            const qty = rnd() < 0.14 ? 2 : 1;
            const hour = 8 + Math.floor(rnd() * 13);
            const createdAt = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00Z`);
            if (createdAt.getTime() > nowMs) continue;
            dayOrders.push(makeOrder(createdAt, date, [{ variantId: p.variant, quantity: qty }], p.price * qty - (qty === 2 ? 9 : 0), c, rnd, nowMs, c.id, s.id, ad.id));
          }
          const mine = dayOrders.filter((o) => o.adId === ad.id).length;
          const purchases = Math.round(mine * c.inflation * (0.92 + rnd() * 0.16) + (mine > 2 && rnd() < 0.3 ? 1 : 0));
          insights.push({
            date, campaignId: c.id, adSetId: s.id, adId: ad.id, spendUsd, purchases,
            valueUsd: (purchases * p.price * 1.04) / FX,
          });
        }
      }
    }
    // Orders that came with no ad tracking at all: direct, organic, WhatsApp.
    const organic = Math.round(dayOrders.length * (0.05 + rnd() * 0.07));
    for (let i = 0; i < organic; i++) {
      const key = (["collagen", "magnesium", "omega", "pack", "immunity"] as ProductKey[])[Math.floor(rnd() * 5)];
      const p = PRODUCTS[key];
      const createdAt = new Date(`${date}T${String(8 + Math.floor(rnd() * 13)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00Z`);
      if (createdAt.getTime() > nowMs) continue;
      dayOrders.push(makeOrder(createdAt, date, [{ variantId: p.variant, quantity: 1 }], p.price, { reversal: 0.1 } as DCampaign, rnd, nowMs, null, null, null));
    }
    orders.push(...dayOrders);
  }

  orders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  orders.forEach((o, i) => {
    o.id = `demo-${i + 1}`;
    o.name = `#${1041 + i}`;
  });
  return { today, orders, insights };
}

function makeOrder(
  createdAt: Date, createdKey: string, lines: { variantId: string; quantity: number }[], totalPrice: number,
  c: Pick<DCampaign, "reversal">, rnd: () => number, nowMs: number,
  campaignId: string | null, adSetId: string | null, adId: string | null,
): DOrder {
  const ageDays = (nowMs - createdAt.getTime()) / 86_400_000;
  let lifecycle: Lifecycle = "DELIVERED";
  let excluded = false;
  let cancelledAt: Date | null = null;
  let totalRefunded = 0;
  const r = rnd();
  if (r < 0.035) {
    excluded = true; // marked fake by the owner
    lifecycle = "PLACED";
  } else if (r < 0.035 + c.reversal) {
    if (rnd() < 0.55) {
      const lag = Math.floor(rnd() * 3);
      if (ageDays >= lag) {
        lifecycle = "CANCELLED";
        cancelledAt = new Date(createdAt.getTime() + (lag + rnd()) * 86_400_000);
      } else lifecycle = "PLACED";
    } else {
      const lag = 4 + Math.floor(rnd() * 8);
      if (ageDays >= lag) {
        lifecycle = "RETURNED";
        cancelledAt = new Date(createdAt.getTime() + (lag + rnd()) * 86_400_000);
      } else lifecycle = "IN_TRANSIT";
    }
  } else if (ageDays < 1.2) lifecycle = "PLACED";
  else if (ageDays < 5) lifecycle = rnd() < 0.8 ? "IN_TRANSIT" : "DELIVERED";
  else if (ageDays > 8 && rnd() < 0.006) lifecycle = "IN_TRANSIT"; // courier lost it
  else {
    lifecycle = "DELIVERED";
    if (rnd() < 0.025) totalRefunded = 20;
  }
  return { id: "", name: "", createdKey, createdAt, lifecycle, excluded, totalPrice, totalRefunded, cancelledAt, lines, campaignId, adSetId, adId };
}

export function world(): World {
  const today = dayKey(new Date());
  if (!cache || cache.today !== today) cache = build(today);
  return cache;
}

// ---------- shared pieces ----------

const COSTS: CostRow[] = Object.values(PRODUCTS).map((p) => ({ variantId: p.variant, unitCost: p.cost, effectiveFrom: new Date("2026-01-01T00:00:00Z") }));
const FEES = { feeOut: FEE_OUT, feeReturn: FEE_RETURN };
const EXPENSES: ExpenseRow[] = [
  { label: "Content and tools", amount: 540, recurrence: "monthly", startDate: new Date("2026-01-01T00:00:00Z"), endDate: null },
];

const toProfitOrder = (o: DOrder): ProfitOrder => ({
  id: o.id, name: o.name, createdAt: o.createdAt, lifecycle: o.lifecycle, totalPrice: o.totalPrice, totalRefunded: o.totalRefunded,
  lines: o.lines,
});

const campaignById = new Map(CAMPAIGNS.map((c) => [c.id, c]));
const adSetById = new Map(CAMPAIGNS.flatMap((c) => c.adSets.map((s) => [s.id, { s, c }] as const)));
const adById = new Map(CAMPAIGNS.flatMap((c) => c.adSets.flatMap((s) => s.ads.map((a) => [a.id, { a, s, c }] as const))));

export function demoPeriod(range: string, today: string, from: string | null, to: string | null, fallback = "30") {
  const r = range || fallback;
  let fromKey = shiftDay(today, -29);
  let toKey = today;
  if (r === "7") fromKey = shiftDay(today, -6);
  else if (r === "60") fromKey = shiftDay(today, -59);
  else if (r === "30") fromKey = shiftDay(today, -29);
  else if (r === "today") fromKey = today;
  else if (r === "month") fromKey = `${today.slice(0, 7)}-01`;
  else if (r === "custom" && from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to) {
    fromKey = from;
    toKey = to;
  }
  return { fromKey, toKey, range: r };
}

// ---------- profit ----------

export function demoProfit(fromKey: string, toKey: string, view: View) {
  const w = world();
  const spendByDay: Record<string, number> = {};
  for (const i of w.insights) spendByDay[i.date] = (spendByDay[i.date] ?? 0) + i.spendUsd * FX;
  const orders = w.orders.filter((o) => !o.excluded).map(toProfitOrder);
  const report = buildReport(orders, COSTS, FEES, EXPENSES, fromKey, toKey, view, undefined, spendByDay);
  return { report, feeOut: FEE_OUT, feeReturn: FEE_RETURN, fxUsdTnd: FX, fromKey, toKey };
}

// ---------- meta truth ----------

export type MetaLevelName = "campaign" | "adset" | "ad";
const REVERSED: Lifecycle[] = ["CANCELLED", "RETURNED", "REFUNDED"];

export function demoMetaLines(level: MetaLevelName, fromKey: string, toKey: string) {
  const w = world();
  const keyOf = (i: { campaignId: string | null; adSetId: string | null; adId: string | null }) =>
    level === "campaign" ? i.campaignId : level === "adset" ? i.adSetId : i.adId;
  interface Acc { spend: number; purchases: number; trueOrders: number; reversed: number; excluded: number; revenue: number; contribution: number }
  const acc = new Map<string, Acc>();
  const slot = (k: string) => {
    let v = acc.get(k);
    if (!v) acc.set(k, (v = { spend: 0, purchases: 0, trueOrders: 0, reversed: 0, excluded: 0, revenue: 0, contribution: 0 }));
    return v;
  };
  for (const i of w.insights) {
    if (i.date < fromKey || i.date > toKey) continue;
    const v = slot(keyOf(i)!);
    v.spend += i.spendUsd * FX;
    v.purchases += i.purchases;
  }
  let unattributed = 0;
  for (const o of w.orders) {
    if (o.createdKey < fromKey || o.createdKey > toKey) continue;
    const k = keyOf(o);
    if (!k) {
      if (!o.excluded && !REVERSED.includes(o.lifecycle)) unattributed += 1;
      continue;
    }
    const v = slot(k);
    if (o.excluded) {
      v.excluded += 1;
      continue;
    }
    if (REVERSED.includes(o.lifecycle)) v.reversed += 1;
    else v.trueOrders += 1;
    const p = orderProfit(toProfitOrder(o), COSTS, FEES, "gross");
    v.contribution += p.profit;
    if (p.counted) v.revenue += p.revenue;
  }
  const nameOf = (k: string): { name: string; parent?: string } => {
    if (level === "campaign") return { name: campaignById.get(k)?.name ?? k };
    if (level === "adset") return { name: adSetById.get(k)?.s.name ?? k, parent: adSetById.get(k)?.c.name };
    return { name: adById.get(k)?.a.name ?? k, parent: adById.get(k)?.s.name };
  };
  const lines: TruthLine[] = [...acc.entries()].map(([key, v]) => ({
    key, ...nameOf(key),
    spendTnd: v.spend, metaPurchases: v.purchases, clicks: Math.round(v.spend * 4.1), impressions: Math.round(v.spend * 410),
    trueOrders: v.trueOrders, reversedOrders: v.reversed, excludedOrders: v.excluded, revenueTnd: v.revenue, contributionTnd: v.contribution,
    ...computeTruth(
      { metaPurchases: v.purchases, trueOrders: v.trueOrders, reversedOrders: v.reversed, excludedOrders: v.excluded, spend: v.spend, revenue: v.revenue, contribution: v.contribution },
      DEFAULT_LIMITS,
    ),
  }));
  lines.sort((a, b) => b.spendTnd - a.spendTnd);
  return { lines, rate: FX, unattributedOrders: unattributed, ordersMissingCost: 0 };
}

export function demoDailyChecks(toKey: string) {
  const w = world();
  const from = shiftDay(w.today, -13); // the duplicate rule starts counting 14 days back in the demo
  const meta: Record<string, number> = {};
  const orders: Record<string, number> = {};
  for (const i of w.insights) meta[i.date] = (meta[i.date] ?? 0) + i.purchases;
  for (const o of w.orders) orders[o.createdKey] = (orders[o.createdKey] ?? 0) + 1;
  return { checks: dayChecks(meta, orders, from, toKey), duplicateStart: from };
}

// ---------- decisions ----------

export function demoDecisions(level: MetaLevelName) {
  const w = world();
  const today = w.today;
  const win = 14;
  const now = new Date(`${today}T15:00:00Z`);
  const main = demoMetaLines(level, shiftDay(today, -(win - 1)), today).lines;
  const recent = new Map(demoMetaLines(level, shiftDay(today, -6), today).lines.map((l) => [l.key, l]));
  const prior = new Map(demoMetaLines(level, shiftDay(today, -13), shiftDay(today, -7)).lines.map((l) => [l.key, l]));
  const campaignsWin = demoMetaLines("campaign", shiftDay(today, -(win - 1)), today).lines;
  const accOrders = campaignsWin.reduce((a, l) => a + l.trueOrders, 0);
  const accContribution = campaignsWin.reduce((a, l) => a + l.contributionTnd, 0);
  const referenceBreakEven = accOrders > 0 && accContribution > 0 ? accContribution / accOrders : null;
  const rate = (l?: TruthLine) => (l && l.shopifyOrders >= 1 ? (l.reversedOrders + l.excludedOrders) / l.shopifyOrders : null);

  const campaignOf = (key: string): DCampaign | undefined =>
    level === "campaign" ? campaignById.get(key) : level === "adset" ? adSetById.get(key)?.c : adById.get(key)?.c;

  const lines: DecisionLine[] = [];
  for (const l of main) {
    if (l.spendTnd <= 0 && l.trueOrders === 0) continue;
    const c = campaignOf(l.key);
    const daysLive = !c || c.startAgo >= 59 ? 999 : c.startAgo + 1;
    const result = decide(
      {
        spend: l.spendTnd, trueOrders: l.trueOrders, trueCpa: l.trueCpa, breakEven: l.breakEvenCpa, referenceBreakEven,
        tracking: l.trackingStatus, daysLive, recentReversalRate: rate(recent.get(l.key)), priorReversalRate: rate(prior.get(l.key)),
        recentShopifyOrders: recent.get(l.key)?.shopifyOrders ?? 0,
        plannedEnd: c?.plannedEnd !== undefined ? shiftDay(today, c.plannedEnd) : null,
        seasonalUntil: c?.seasonalUntil !== undefined ? shiftDay(today, c.seasonalUntil) : null,
        reviewDate: null, lastScaleSuggestedAt: null, today, now,
      },
      DEFAULT_RULES,
    );
    lines.push({
      key: l.key, name: l.name, parent: l.parent, spendTnd: l.spendTnd, trueOrders: l.trueOrders, trueCpa: l.trueCpa,
      breakEven: l.breakEvenCpa, trackingStatus: l.trackingStatus, daysLive, result,
    });
  }
  const order: Record<VerdictName, number> = { KILL: 0, PAUSE: 1, SCALE: 2, CALENDAR: 3, WATCH: 4 };
  lines.sort((a, b) => order[a.result.verdict] - order[b.result.verdict] || b.spendTnd - a.spendTnd);
  const values: Record<string, number> = { ...DEFAULT_RULES, verdict_window_days: win, tracking_amber_ratio: DEFAULT_LIMITS.amberRatio, tracking_red_ratio: DEFAULT_LIMITS.redRatio };
  return { lines, referenceBreakEven, windowDays: win, values, ratesMissing: false };
}

// ---------- real revenue ----------

type ReconcileResult = Awaited<ReturnType<typeof getReconciliation>>;

export function demoReconcile(fromKey: string, toKey: string): ReconcileResult {
  const w = world();
  const now = new Date(`${w.today}T15:00:00Z`);
  const all = w.orders;
  const inPeriod = all.filter((o) => o.createdKey >= fromKey && o.createdKey <= toKey);
  const byDay = new Map<string, RecTotals>();
  for (const o of inPeriod) {
    let t = byDay.get(o.createdKey);
    if (!t) byDay.set(o.createdKey, (t = emptyTotals()));
    addOrder(t, o);
  }
  const metaByDay = new Map<string, { p: number; v: number; s: number }>();
  for (const i of w.insights) {
    const m = metaByDay.get(i.date) ?? { p: 0, v: 0, s: 0 };
    m.p += i.purchases;
    m.v += i.valueUsd * FX;
    m.s += i.spendUsd * FX;
    metaByDay.set(i.date, m);
  }
  const days: ReconcileResult["days"] = [];
  for (let k = fromKey; k <= toKey && days.length < 120; k = shiftDay(k, 1)) {
    const m = metaByDay.get(k);
    days.push({ date: k, totals: byDay.get(k) ?? emptyTotals(), metaPurchases: m?.p ?? 0, metaRevenueTnd: m?.v ?? 0, spendTnd: m?.s ?? 0 });
  }
  const reversalsPosted: ReconcileResult["reversalsPosted"] = all
    .filter((o) => !o.excluded && o.cancelledAt && REVERSED.includes(o.lifecycle))
    .map((o) => ({ o, rk: dayKey(o.cancelledAt!) }))
    .filter(({ rk }) => rk >= fromKey && rk <= toKey)
    .map(({ o, rk }) => ({
      name: o.name, createdKey: o.createdKey, reversedKey: rk,
      lagDays: Math.max(0, Math.round((Date.parse(rk) - Date.parse(o.createdKey)) / 86_400_000)),
      value: o.totalPrice, campaign: o.campaignId ? campaignById.get(o.campaignId)?.name ?? null : null,
      olderThanPeriod: o.createdKey < fromKey, lifecycle: o.lifecycle,
    }))
    .sort((a, b) => b.reversedKey.localeCompare(a.reversedKey));
  return {
    totals: reconcile(inPeriod),
    days,
    metaPurchases: days.reduce((a, d) => a + d.metaPurchases, 0),
    metaRevenueTnd: days.reduce((a, d) => a + d.metaRevenueTnd, 0),
    spendTnd: days.reduce((a, d) => a + d.spendTnd, 0),
    reversalsPosted,
    refundedPosted: all.filter((o) => o.totalRefunded > 0 && o.createdKey >= fromKey && o.createdKey <= toKey).reduce((a, o) => a + o.totalRefunded, 0),
    lag: reversalLag(all),
    stale: staleOrders(all, now, 7).map((o) => ({
      name: o.name, ageDays: o.ageDays, value: o.totalPrice - o.totalRefunded, lifecycle: o.lifecycle,
      campaign: o.campaignId ? campaignById.get(o.campaignId)?.name ?? null : null,
    })),
    provisional: provisionalShare(inPeriod, now, 30),
    staleDays: 7,
    finalAfterDays: 30,
    ratesMissing: false,
  };
}

// ---------- health ----------

export function demoHealth(): Check[] {
  const w = world();
  const attributed = w.orders.filter((o) => o.campaignId).length;
  return [
    { name: "Orders in the app", level: "ok", detail: `${w.orders.length} orders stored, Shopify reports the same number.` },
    { name: "Orders re-checked", level: "ok", detail: "Last check 2 h ago. Late cancellations and returns are picked up on every app open." },
    { name: "Meta connection", level: "ok", detail: "The access token works and reads the ad account." },
    { name: "Meta data fresh", level: "ok", detail: "Synced 3 h ago, 60 days of ad-level data." },
    { name: "Exchange rate", level: "ok", detail: `1 USD = ${FX.toFixed(2)} TND.` },
    { name: "Delivery fee", level: "ok", detail: `${FEE_OUT} TND per parcel, ${FEE_RETURN} TND extra for returns.` },
    { name: "Product costs", level: "ok", detail: "Every variant sold has a cost." },
    { name: "Ad tracking coverage", level: "warn", detail: `${Math.round((attributed / w.orders.length) * 100)}% of orders carry ad tracking data. The rest are direct or organic.`, fix: "Add UTM parameters to the links in your Instagram bio and WhatsApp campaigns." },
    { name: "Calendar", level: "ok", detail: "No overdue reviews." },
  ];
}
