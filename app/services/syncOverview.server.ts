import db from "../db.server";
import { median, suggestFake } from "../lib/duplicates.ts";
import { isReversed, isStale } from "../lib/lifecycle.ts";
import { getSettings } from "./orderSync.server";

const DAY_MS = 86_400_000;

export interface ReviewRow {
  id: string;
  name: string;
  createdAt: string;
  total: number;
  currency: string;
  lifecycle: string;
  note: string;
}

// Everything the Sync page shows, in one place.
export async function getOverview(shop: string) {
  const settings = await getSettings(shop);
  const now = new Date();

  const [byLifecycle, total] = await Promise.all([
    db.order.groupBy({ by: ["lifecycle"], where: { shop, excluded: false }, _count: { _all: true } }),
    db.order.count({ where: { shop } }),
  ]);

  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const [attrTotal, attrNone, inTransit] = await Promise.all([
    db.order.count({ where: { shop, excluded: false, createdAtShopify: { gte: since30 } } }),
    db.order.count({
      where: { shop, excluded: false, createdAtShopify: { gte: since30 }, attribution: { is: { method: "NONE" } } },
    }),
    db.order.findMany({
      where: { shop, lifecycle: "IN_TRANSIT", excluded: false },
      select: { lifecycle: true, fulfilledAt: true },
    }),
  ]);
  const staleCount = inTransit.filter((o) => isStale(o.lifecycle, o.fulfilledAt, now, settings.stale_days)).length;

  // Fake-order suggestions: look at the last 90 days (non-excluded).
  const since90 = new Date(now.getTime() - 90 * DAY_MS);
  const recent = await db.order.findMany({
    where: { shop, excluded: false, createdAtShopify: { gte: since90 } },
    select: {
      id: true,
      name: true,
      createdAtShopify: true,
      cancelledAt: true,
      lifecycle: true,
      totalPrice: true,
      currency: true,
      possibleDuplicateOf: true,
      lines: { select: { quantity: true } },
    },
    orderBy: { createdAtShopify: "desc" },
  });
  const medianTicket = median(recent.filter((o) => !isReversed(o.lifecycle)).map((o) => Number(o.totalPrice)));

  const fakeSuggestions: ReviewRow[] = [];
  for (const o of recent) {
    const s = suggestFake(
      {
        quantity: o.lines.reduce((n, l) => n + l.quantity, 0),
        totalPrice: Number(o.totalPrice),
        lifecycle: o.lifecycle,
        createdAt: o.createdAtShopify,
        cancelledAt: o.cancelledAt,
      },
      {
        medianTicket,
        qtyThreshold: settings.fake_qty_threshold,
        ticketMultiple: settings.fake_ticket_multiple,
        cancelWindowHours: settings.fake_cancel_window_hours,
      },
    );
    if (s.level === "none") continue;
    fakeSuggestions.push({
      id: o.id,
      name: o.name,
      createdAt: o.createdAtShopify.toISOString(),
      total: Number(o.totalPrice),
      currency: o.currency,
      lifecycle: o.lifecycle,
      note: `${s.level === "likely" ? "Likely fake" : "Review"}: ${s.reasons.join("; ")}`,
    });
  }

  // Possible duplicates (flag only).
  const dupRows = recent.filter((o) => o.possibleDuplicateOf).slice(0, 25);
  const dupTargets = await db.order.findMany({
    where: { id: { in: dupRows.map((o) => o.possibleDuplicateOf!) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(dupTargets.map((t) => [t.id, t.name]));
  const duplicates: ReviewRow[] = dupRows.map((o) => ({
    id: o.id,
    name: o.name,
    createdAt: o.createdAtShopify.toISOString(),
    total: Number(o.totalPrice),
    currency: o.currency,
    lifecycle: o.lifecycle,
    note: `Same phone as ${nameById.get(o.possibleDuplicateOf!) ?? "an earlier order"} within ${settings.duplicate_window_hours}h`,
  }));

  const excludedRows = await db.order.findMany({
    where: { shop, excluded: true },
    select: { id: true, name: true, createdAtShopify: true, totalPrice: true, currency: true, lifecycle: true, excludedReason: true },
    orderBy: { createdAtShopify: "desc" },
    take: 25,
  });

  return {
    total,
    byLifecycle: byLifecycle.map((r) => ({ lifecycle: r.lifecycle as string, count: r._count._all })),
    staleCount,
    staleDays: settings.stale_days,
    unattributed: { none: attrNone, total: attrTotal },
    medianTicket,
    fakeSuggestions: fakeSuggestions.slice(0, 25),
    duplicates,
    excluded: excludedRows.map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAtShopify.toISOString(),
      total: Number(o.totalPrice),
      currency: o.currency,
      lifecycle: o.lifecycle as string,
      note: `Excluded as ${o.excludedReason ?? "fake"}`,
    })) as ReviewRow[],
  };
}
