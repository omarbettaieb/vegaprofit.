import { Prisma } from "@prisma/client";
import db from "../db.server";
import { decide, DEFAULT_RULES } from "../lib/verdict.ts";
import type { VerdictName, VerdictResult, VerdictRules } from "../lib/verdict.ts";
import { dayKey, shiftDay } from "../lib/profit.ts";
import type { Settings } from "../lib/settings.ts";
import { getMetaLines } from "./meta.server";
import type { MetaLevelName, TruthLine } from "./meta.server";
import { getSettings } from "./orderSync.server";

const LEVEL_DB = { campaign: "CAMPAIGN", adset: "ADSET", ad: "AD" } as const;

export function rulesFrom(s: Settings): VerdictRules {
  const out = { ...DEFAULT_RULES };
  for (const k of Object.keys(DEFAULT_RULES) as (keyof VerdictRules)[]) out[k] = s[k];
  return out;
}

export interface DecisionLine {
  key: string;
  name: string;
  parent?: string;
  spendTnd: number;
  trueOrders: number;
  trueCpa: number | null;
  breakEven: number | null;
  trackingStatus: TruthLine["trackingStatus"];
  daysLive: number;
  result: VerdictResult;
}

// ---------- calendar ----------

export interface CalendarItem {
  id: string;
  date: string;
  kind: string;
  title: string;
  note: string | null;
  done: boolean;
  level: string | null;
  entityMetaId: string | null;
  auto: boolean;
}

const OCTOBRE_ROSE_ID = "120248705600060179";

// First visit only: Octobre Rose ends 31 Oct (from the campaign brief); prices come back on 1 Nov.
export async function seedCalendarOnce(shop: string) {
  const done = await db.setting.findUnique({ where: { shop_key: { shop, key: "calendar_seeded" } } });
  if (done) return;
  await db.shop.upsert({ where: { shop }, create: { shop }, update: {} });
  await db.reviewCalendarEvent.createMany({
    data: [
      { shop, level: "CAMPAIGN", entityMetaId: OCTOBRE_ROSE_ID, date: new Date("2026-10-31T00:00:00Z"), kind: "campaign_end", title: "Octobre Rose campaign ends (23:59)" },
      { shop, level: null, entityMetaId: null, date: new Date("2026-11-01T00:00:00Z"), kind: "review", title: "Octobre Rose is over: restore normal prices" },
    ],
  });
  await db.setting.create({ data: { shop, key: "calendar_seeded", value: true } });
}

const toKey = (d: Date) => d.toISOString().slice(0, 10);

export async function listCalendar(shop: string, fromKey: string, toKeyStr: string): Promise<CalendarItem[]> {
  const [events, history] = await Promise.all([
    db.reviewCalendarEvent.findMany({
      where: { shop, date: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKeyStr}T00:00:00Z`) } },
      orderBy: { date: "asc" },
    }),
    db.verdictHistory.findMany({
      where: { shop, nextReviewDate: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKeyStr}T00:00:00Z`) } },
      orderBy: { computedAt: "desc" },
    }),
  ]);
  const items: CalendarItem[] = events.map((e) => ({
    id: e.id, date: toKey(e.date), kind: e.kind, title: e.title, note: e.note, done: e.done,
    level: e.level, entityMetaId: e.entityMetaId, auto: false,
  }));
  // Automatic review dates from the latest verdict of each entity (learning window ends, seasonal windows).
  const seen = new Set<string>();
  const names = await entityNames(shop);
  for (const h of history) {
    const k = `${h.level}:${h.entityMetaId}`;
    if (seen.has(k) || !h.nextReviewDate) continue;
    seen.add(k);
    items.push({
      id: `auto-${h.id}`, date: toKey(h.nextReviewDate), kind: "auto_review",
      title: `Review ${names.get(h.entityMetaId) ?? h.entityMetaId}`, note: h.reason, done: false,
      level: h.level, entityMetaId: h.entityMetaId, auto: true,
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

async function entityNames(shop: string): Promise<Map<string, string>> {
  const [c, s, a] = await Promise.all([
    db.metaCampaign.findMany({ where: { shop }, select: { metaId: true, name: true } }),
    db.metaAdSet.findMany({ where: { shop }, select: { metaId: true, name: true } }),
    db.metaAd.findMany({ where: { shop }, select: { metaId: true, name: true } }),
  ]);
  return new Map([...c, ...s, ...a].map((e) => [e.metaId, e.name]));
}

export async function entityChoices(shop: string): Promise<{ level: string; metaId: string; name: string }[]> {
  const [c, s, a] = await Promise.all([
    db.metaCampaign.findMany({ where: { shop }, select: { metaId: true, name: true }, orderBy: { name: "asc" } }),
    db.metaAdSet.findMany({ where: { shop }, select: { metaId: true, name: true }, orderBy: { name: "asc" } }),
    db.metaAd.findMany({ where: { shop }, select: { metaId: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return [
    ...c.map((e) => ({ level: "CAMPAIGN", metaId: e.metaId, name: `Campaign: ${e.name}` })),
    ...s.map((e) => ({ level: "ADSET", metaId: e.metaId, name: `Ad set: ${e.name}` })),
    ...a.map((e) => ({ level: "AD", metaId: e.metaId, name: `Ad: ${e.name}` })),
  ];
}

export async function addCalendarEvent(
  shop: string,
  e: { date: string; kind: string; title: string; note?: string; level?: string | null; entityMetaId?: string | null },
) {
  await db.shop.upsert({ where: { shop }, create: { shop }, update: {} });
  const level = e.level === "CAMPAIGN" || e.level === "ADSET" || e.level === "AD" ? e.level : null;
  await db.reviewCalendarEvent.create({
    data: {
      shop, level, entityMetaId: level ? e.entityMetaId ?? null : null,
      date: new Date(`${e.date}T00:00:00Z`), kind: e.kind, title: e.title, note: e.note || null,
    },
  });
}

export async function setCalendarDone(shop: string, id: string, done: boolean) {
  await db.reviewCalendarEvent.updateMany({ where: { id, shop }, data: { done } });
}

export async function deleteCalendarEvent(shop: string, id: string) {
  await db.reviewCalendarEvent.deleteMany({ where: { id, shop } });
}

export async function saveRules(shop: string, values: Record<string, number>) {
  await db.shop.upsert({ where: { shop }, create: { shop }, update: {} });
  const allowed = new Set<string>([...Object.keys(DEFAULT_RULES), "verdict_window_days", "tracking_amber_ratio", "tracking_red_ratio"]);
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key) || !Number.isFinite(value)) continue;
    await db.setting.upsert({ where: { shop_key: { shop, key } }, create: { shop, key, value }, update: { value } });
  }
}

// ---------- verdicts ----------

const SEASONAL_FROM = /from:(\d{4}-\d{2}-\d{2})/;

export async function getDecisions(shop: string, level: MetaLevelName): Promise<{ lines: DecisionLine[]; referenceBreakEven: number | null; windowDays: number; values: Record<string, number>; ratesMissing: boolean }> {
  await seedCalendarOnce(shop);
  const settings = await getSettings(shop);
  const rules = rulesFrom(settings);
  const today = dayKey(new Date());
  const win = Math.max(1, Math.round(settings.verdict_window_days));
  const now = new Date();

  const [main, recent, prior, campaignsWin, firstSeen, ads, adSets, events, history] = await Promise.all([
    getMetaLines(shop, level, shiftDay(today, -(win - 1)), today),
    getMetaLines(shop, level, shiftDay(today, -6), today),
    getMetaLines(shop, level, shiftDay(today, -13), shiftDay(today, -7)),
    getMetaLines(shop, "campaign", shiftDay(today, -(win - 1)), today),
    db.metaInsightsDaily.groupBy({ by: ["entityMetaId"], where: { shop, level: "AD", spend: { gt: 0 } }, _min: { date: true } }),
    db.metaAd.findMany({ where: { shop }, select: { metaId: true, adSet: { select: { metaId: true, campaign: { select: { metaId: true } } } } } }),
    db.metaAdSet.findMany({ where: { shop }, select: { metaId: true, campaign: { select: { metaId: true } } } }),
    db.reviewCalendarEvent.findMany({ where: { shop, done: false } }),
    db.verdictHistory.findMany({ where: { shop, level: LEVEL_DB[level] }, orderBy: { computedAt: "desc" }, take: 2000 }),
  ]);

  // Account-wide break-even, used when one entity has no orders of its own yet.
  const accOrders = campaignsWin.lines.reduce((a, l) => a + l.trueOrders, 0);
  const accContribution = campaignsWin.lines.reduce((a, l) => a + l.contributionTnd, 0);
  const referenceBreakEven = accOrders > 0 && accContribution > 0 ? accContribution / accOrders : null;

  // ancestors of each key (itself, ad set, campaign)
  const adSetOfAd = new Map(ads.map((a) => [a.metaId, a.adSet.metaId]));
  const campaignOfAdSet = new Map(adSets.map((s) => [s.metaId, s.campaign.metaId]));
  const campaignOfAd = new Map(ads.map((a) => [a.metaId, a.adSet.campaign.metaId]));
  const chain = (key: string): string[] => {
    if (level === "campaign") return [key];
    if (level === "adset") return [key, campaignOfAdSet.get(key) ?? ""];
    return [key, adSetOfAd.get(key) ?? "", campaignOfAd.get(key) ?? ""];
  };

  // first spend date per entity at this level
  const first = new Map<string, string>();
  for (const r of firstSeen) {
    const d = r._min.date;
    if (!d) continue;
    const ds = d.toISOString().slice(0, 10);
    const k = level === "ad" ? r.entityMetaId : level === "adset" ? adSetOfAd.get(r.entityMetaId) : campaignOfAd.get(r.entityMetaId);
    if (!k) continue;
    if (!first.has(k) || ds < first.get(k)!) first.set(k, ds);
  }
  const dataStart = shiftDay(today, -59); // sync keeps 60 days; anything that old started earlier

  const recentBy = new Map(recent.lines.map((l) => [l.key, l]));
  const priorBy = new Map(prior.lines.map((l) => [l.key, l]));
  const rate = (l?: TruthLine) => (l && l.shopifyOrders >= 1 ? (l.reversedOrders + l.excludedOrders) / l.shopifyOrders : null);
  const lastScale = new Map<string, Date>();
  const lastRow = new Map<string, (typeof history)[number]>();
  for (const h of history) {
    if (!lastRow.has(h.entityMetaId)) lastRow.set(h.entityMetaId, h);
    const m = h.metrics as { scaleSuggested?: boolean } | null;
    if (m?.scaleSuggested && !lastScale.has(h.entityMetaId)) lastScale.set(h.entityMetaId, h.computedAt);
  }

  const lines: DecisionLine[] = [];
  const toStore: Prisma.VerdictHistoryCreateManyInput[] = [];
  for (const l of main.lines) {
    if (l.spendTnd <= 0 && l.trueOrders === 0) continue;
    const mine = events.filter((e) => chain(l.key).includes(e.entityMetaId ?? "∅"));
    const globals = events.filter((e) => !e.entityMetaId);
    const future = (e: (typeof events)[number]) => toKey(e.date) >= today;
    const plannedEnd = mine.filter((e) => e.kind === "campaign_end" && future(e)).map((e) => toKey(e.date)).sort()[0] ?? null;
    const reviewDate = mine.filter((e) => e.kind === "review" && future(e)).map((e) => toKey(e.date)).sort()[0] ?? null;
    const seasonalUntil = [...mine, ...globals]
      .filter((e) => e.kind === "seasonal_window" && future(e) && (SEASONAL_FROM.exec(e.note ?? "")?.[1] ?? "0000-00-00") <= today)
      .map((e) => toKey(e.date)).sort()[0] ?? null;

    const f = first.get(l.key);
    const daysLive = !f || f <= dataStart ? 999 : Math.max(1, Math.round((Date.parse(today) - Date.parse(f)) / 86_400_000) + 1);

    const result = decide(
      {
        spend: l.spendTnd, trueOrders: l.trueOrders, trueCpa: l.trueCpa, breakEven: l.breakEvenCpa, referenceBreakEven,
        tracking: l.trackingStatus, daysLive, recentReversalRate: rate(recentBy.get(l.key)), priorReversalRate: rate(priorBy.get(l.key)),
        recentShopifyOrders: recentBy.get(l.key)?.shopifyOrders ?? 0, plannedEnd, seasonalUntil, reviewDate,
        lastScaleSuggestedAt: lastScale.get(l.key) ?? null, today, now,
      },
      rules,
    );
    lines.push({ key: l.key, name: l.name, parent: l.parent, spendTnd: l.spendTnd, trueOrders: l.trueOrders, trueCpa: l.trueCpa, breakEven: l.breakEvenCpa, trackingStatus: l.trackingStatus, daysLive, result });

    // Keep a history row when the verdict changes, daily, or when a scale suggestion is made.
    const prev = lastRow.get(l.key);
    const stale = !prev || prev.verdict !== (result.verdict as VerdictName) || now.getTime() - prev.computedAt.getTime() > 86_400_000;
    if (stale || result.scaleSuggestion) {
      toStore.push({
        shop, level: LEVEL_DB[level], entityMetaId: l.key, verdict: result.verdict, reason: result.reason,
        nextReviewDate: result.nextReview ? new Date(`${result.nextReview}T00:00:00Z`) : null,
        metrics: {
          spend: l.spendTnd, trueOrders: l.trueOrders, trueCpa: l.trueCpa, breakEven: l.breakEvenCpa, metaPurchases: l.metaPurchases,
          unexplained: l.unexplained, tracking: l.trackingStatus, scaleSuggested: result.scaleSuggestion !== null,
        },
      });
    }
  }
  if (toStore.length) await db.verdictHistory.createMany({ data: toStore });

  const order: Record<VerdictName, number> = { KILL: 0, PAUSE: 1, SCALE: 2, CALENDAR: 3, WATCH: 4 };
  lines.sort((a, b) => order[a.result.verdict] - order[b.result.verdict] || b.spendTnd - a.spendTnd);
  const values: Record<string, number> = { ...rules, verdict_window_days: win, tracking_amber_ratio: settings.tracking_amber_ratio, tracking_red_ratio: settings.tracking_red_ratio };
  return { lines, referenceBreakEven, windowDays: win, values, ratesMissing: settings.fx_usd_tnd === 0 };
}
