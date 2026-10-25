import test from "node:test";
import assert from "node:assert/strict";
import { computeTruth, dayChecks, trackingStatus } from "./truth.ts";

test("marine collagen example: 22 Meta purchases vs 9 Shopify orders is RED with 13 unexplained", () => {
  const t = computeTruth({ metaPurchases: 22, trueOrders: 5, reversedOrders: 3, excludedOrders: 1, spend: 477.69, revenue: 460, contribution: 200 });
  assert.equal(t.shopifyOrders, 9);
  assert.equal(t.unexplained, 13);
  assert.equal(t.trackingStatus, "RED");
  assert.equal(Math.round(t.trueCpa! * 100) / 100, 95.54);
  assert.equal(t.breakEvenCpa, 40);
  assert.ok(t.cpaVsBreakEven! > 2);
  assert.equal(Math.round(t.inflationPct!), 144);
});

test("tracking status thresholds and low data", () => {
  assert.equal(trackingStatus(10, 9), "GREEN");
  assert.equal(trackingStatus(12, 9), "AMBER");
  assert.equal(trackingStatus(20, 9), "RED");
  assert.equal(trackingStatus(2, 1), "LOW");
  assert.equal(trackingStatus(6, 0), "RED");
});

test("break-even is null when the orders make no contribution", () => {
  const t = computeTruth({ metaPurchases: 3, trueOrders: 3, reversedOrders: 0, excludedOrders: 0, spend: 90, revenue: 150, contribution: -10 });
  assert.equal(t.breakEvenCpa, null);
  assert.equal(t.breakEvenRoas, null);
  assert.equal(t.unexplained, 0);
});

test("day checks flag only Meta purchases beyond the orders that exist", () => {
  const rows = dayChecks({ "2026-10-14": 3, "2026-10-15": 1 }, { "2026-10-14": 2, "2026-10-15": 4, "2026-10-13": 9 }, "2026-10-14", "2026-10-16");
  assert.deepEqual(rows.map((r) => [r.date, r.duplicates]), [["2026-10-14", 1], ["2026-10-15", 0]]);
});
