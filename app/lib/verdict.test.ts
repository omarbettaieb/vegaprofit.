import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "./verdict.ts";
import type { VerdictInput } from "./verdict.ts";

const base: VerdictInput = {
  spend: 100, trueOrders: 12, trueCpa: 40, breakEven: 50, referenceBreakEven: 50, tracking: "GREEN", daysLive: 10,
  recentReversalRate: 0.2, priorReversalRate: 0.2, recentShopifyOrders: 6, plannedEnd: null, seasonalUntil: null, reviewDate: null,
  lastScaleSuggestedAt: null, today: "2026-10-25", now: new Date("2026-10-25T10:00:00Z"),
};
const v = (o: Partial<VerdictInput>) => decide({ ...base, ...o });

test("learning window comes first and sets the review day", () => {
  const r = v({ daysLive: 2, spend: 500, trueOrders: 0, trueCpa: null });
  assert.equal(r.verdict, "CALENDAR");
  assert.equal(r.nextReview, "2026-10-27");
});

test("no break-even anywhere means WATCH", () => {
  assert.equal(v({ breakEven: null, referenceBreakEven: null }).verdict, "WATCH");
});

test("KILL: 2x break-even spent with zero orders, or 10+ orders above 1.5x", () => {
  assert.equal(v({ trueOrders: 0, trueCpa: null, spend: 100 }).verdict, "KILL");
  assert.equal(v({ trueOrders: 0, trueCpa: null, spend: 99 }).verdict, "WATCH");
  assert.equal(v({ trueOrders: 10, trueCpa: 80, spend: 800 }).verdict, "KILL");
});

test("uses the account break-even when the entity has none", () => {
  assert.equal(v({ breakEven: null, trueOrders: 0, trueCpa: null, spend: 120 }).verdict, "KILL");
});

test("PAUSE: early rule, tracking RED, or 1.2x-1.5x with enough orders", () => {
  assert.equal(v({ trueOrders: 2, trueCpa: 110, spend: 220 }).verdict, "PAUSE"); // spend 4.4x, cpa 2.2x
  assert.equal(v({ tracking: "RED" }).verdict, "PAUSE");
  assert.equal(v({ trueOrders: 12, trueCpa: 65, spend: 780 }).verdict, "PAUSE"); // 1.3x
});

test("KILL beats a review date, but a review date holds back PAUSE and SCALE", () => {
  assert.equal(v({ trueOrders: 0, trueCpa: null, spend: 120, reviewDate: "2026-10-30" }).verdict, "KILL");
  assert.equal(v({ reviewDate: "2026-10-30" }).verdict, "CALENDAR");
  assert.equal(v({ trueOrders: 12, trueCpa: 65, spend: 780, reviewDate: "2026-10-30" }).verdict, "CALENDAR");
});

test("campaign ending soon is CALENDAR, ending later is judged normally", () => {
  assert.equal(v({ plannedEnd: "2026-10-27" }).verdict, "CALENDAR");
  assert.equal(v({ plannedEnd: "2026-11-20" }).verdict, "SCALE");
  assert.equal(v({ seasonalUntil: "2026-11-05" }).verdict, "CALENDAR");
});

test("SCALE needs 10 orders, cpa <= 0.8x, no rising reversals; suggestion once per 48h", () => {
  const s = v({});
  assert.equal(s.verdict, "SCALE");
  assert.ok(s.scaleSuggestion);
  const again = v({ lastScaleSuggestedAt: new Date("2026-10-24T10:00:00Z") });
  assert.equal(again.verdict, "SCALE");
  assert.equal(again.scaleSuggestion, null);
  const rising = v({ recentReversalRate: 0.5, priorReversalRate: 0.2 });
  assert.equal(rising.verdict, "WATCH");
  assert.equal(v({ trueOrders: 9 }).verdict, "WATCH");
});

test("WATCH inside the hold range", () => {
  assert.equal(v({ trueCpa: 50, spend: 600 }).verdict, "WATCH"); // 1.0x
  assert.equal(v({ trueCpa: 58, spend: 700 }).verdict, "WATCH"); // 1.16x
});
