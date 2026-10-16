import test from "node:test";
import assert from "node:assert/strict";
import { cpa, parseInsightRow, purchaseCount, purchaseValue, spendByDay } from "./meta.ts";

test("purchase counts take one action type, never the sum", () => {
  const actions = [
    { action_type: "omni_purchase", value: "3" },
    { action_type: "purchase", value: "2" },
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
  ];
  assert.equal(purchaseCount(actions), 2);
  assert.equal(purchaseCount([{ action_type: "offsite_conversion.fb_pixel_purchase", value: "4" }]), 4);
  assert.equal(purchaseCount(undefined), 0);
  assert.equal(purchaseValue([{ action_type: "purchase", value: "12.28" }]), 12.28);
});

test("parseInsightRow reads numbers and skips incomplete rows", () => {
  const row = parseInsightRow({
    date_start: "2026-10-14",
    campaign_id: "1",
    campaign_name: "C",
    adset_id: "2",
    adset_name: "S",
    ad_id: "3",
    ad_name: "A",
    spend: "11.84",
    impressions: "4619",
    clicks: "125",
    actions: [{ action_type: "purchase", value: "1" }],
    action_values: [{ action_type: "purchase", value: "12.28" }],
  });
  assert.ok(row);
  assert.equal(row.spend, 11.84);
  assert.equal(row.purchases, 1);
  assert.equal(row.frequency, null);
  assert.equal(parseInsightRow({ date_start: "bad", ad_id: "3", adset_id: "2", campaign_id: "1" }), null);
  assert.equal(parseInsightRow({ date_start: "2026-10-14", adset_id: "2", campaign_id: "1" }), null);
});

test("spend per day converts with the typed rate and adds ads of the same day", () => {
  const d = spendByDay(
    [
      { date: "2026-10-14", spend: 10 },
      { date: "2026-10-14", spend: 5 },
      { date: "2026-10-15", spend: 2 },
    ],
    3,
  );
  assert.equal(d["2026-10-14"], 45);
  assert.equal(d["2026-10-15"], 6);
});

test("cpa is null without orders", () => {
  assert.equal(cpa(30, 0), null);
  assert.equal(cpa(30, 3), 10);
});
