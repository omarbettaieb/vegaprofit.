import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getProfitReport } from "../services/profit.server";
import { getMetaLines } from "../services/meta.server";
import { dayKey, firstOfMonth, shiftDay } from "../lib/profit.ts";
import { toCsv } from "../lib/csv.ts";
import type { View } from "../lib/types.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const today = dayKey(new Date());
  const range = url.searchParams.get("range") ?? "30";
  const view: View = url.searchParams.get("view") === "net" ? "net" : "gross";
  let fromKey = shiftDay(today, -29);
  let toKey = today;
  if (range === "7") fromKey = shiftDay(today, -6);
  else if (range === "60") fromKey = shiftDay(today, -59);
  else if (range === "month") fromKey = firstOfMonth(today);
  else if (range === "custom") {
    const f = url.searchParams.get("from") ?? "";
    const t = url.searchParams.get("to") ?? "";
    if (DATE_RE.test(f) && DATE_RE.test(t) && f <= t) {
      fromKey = f;
      toKey = t;
    }
  }

  const [profit, campaigns, adsets, ads, orders, names] = await Promise.all([
    getProfitReport(shop, fromKey, toKey, view),
    getMetaLines(shop, "campaign", fromKey, toKey),
    getMetaLines(shop, "adset", fromKey, toKey),
    getMetaLines(shop, "ad", fromKey, toKey),
    db.order.findMany({
      where: { shop, createdAtShopify: { gte: new Date(`${shiftDay(fromKey, -1)}T00:00:00Z`), lt: new Date(`${shiftDay(toKey, 2)}T00:00:00Z`) } },
      select: {
        name: true, createdAtShopify: true, lifecycle: true, excluded: true, totalPrice: true, totalRefunded: true, cancelledAt: true,
        attribution: { select: { campaignId: true, adSetId: true, adId: true } },
      },
      orderBy: { createdAtShopify: "asc" },
    }),
    Promise.all([
      db.metaCampaign.findMany({ where: { shop }, select: { metaId: true, name: true } }),
      db.metaAdSet.findMany({ where: { shop }, select: { metaId: true, name: true } }),
      db.metaAd.findMany({ where: { shop }, select: { metaId: true, name: true } }),
    ]),
  ]);
  const nameOf = new Map(names.flat().map((e) => [e.metaId, e.name]));

  const truthHeader = ["name", "parent", "spend_tnd", "meta_purchases", "shopify_orders", "cancelled_returned", "fake", "true_orders", "unexplained", "tracking", "true_cost_per_order", "break_even_cost", "true_roas", "break_even_roas", "revenue_tnd"];
  const truthRows = (lines: typeof campaigns.lines) =>
    lines.map((l) => [l.name, l.parent ?? "", l.spendTnd, l.metaPurchases, l.shopifyOrders, l.reversedOrders, l.excludedOrders, l.trueOrders, l.unexplained, l.trackingStatus, l.trueCpa, l.breakEvenCpa, l.trueRoas, l.breakEvenRoas, l.revenueTnd]);

  const files = [
    {
      label: "Profit by day",
      file: `profit-${view}-${fromKey}-${toKey}.csv`,
      csv: toCsv(
        ["date", "orders", "revenue", "product_cost", "delivery", "expenses", "profit_before_ads", "ad_spend", "profit_after_ads"],
        profit.report.days.map((d) => [d.date, d.orders, d.revenue, d.cogs, d.delivery, d.expenses, d.profit, d.adSpend, d.profitAfterAds]),
      ),
    },
    { label: "Meta truth: campaigns", file: `meta-campaigns-${fromKey}-${toKey}.csv`, csv: toCsv(truthHeader, truthRows(campaigns.lines)) },
    { label: "Meta truth: ad sets", file: `meta-adsets-${fromKey}-${toKey}.csv`, csv: toCsv(truthHeader, truthRows(adsets.lines)) },
    { label: "Meta truth: ads", file: `meta-ads-${fromKey}-${toKey}.csv`, csv: toCsv(truthHeader, truthRows(ads.lines)) },
    {
      label: "Orders (no customer data)",
      file: `orders-${fromKey}-${toKey}.csv`,
      csv: toCsv(
        ["order", "day_placed", "status", "fake", "total_tnd", "refunded_tnd", "reversed_on", "campaign", "ad_set", "ad"],
        orders.map((o) => [
          o.name, dayKey(o.createdAtShopify), o.lifecycle, o.excluded, Number(o.totalPrice), Number(o.totalRefunded),
          o.cancelledAt ? dayKey(o.cancelledAt) : "",
          o.attribution?.campaignId ? nameOf.get(o.attribution.campaignId) ?? o.attribution.campaignId : "",
          o.attribution?.adSetId ? nameOf.get(o.attribution.adSetId) ?? o.attribution.adSetId : "",
          o.attribution?.adId ? nameOf.get(o.attribution.adId) ?? o.attribution.adId : "",
        ]),
      ),
    },
  ];
  return { files, range, view, fromKey, toKey };
};

const input = { padding: "6px 8px", border: "1px solid #8a8a8a", borderRadius: 6 };
const btn = { padding: "6px 12px", border: "1px solid #8a8a8a", borderRadius: 6, background: "#fff", cursor: "pointer" };

function download(name: string, text: string) {
  try {
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    // blocked: the text box below stays available for copy and paste
  }
}

export default function ExportPage() {
  const { files, range, view, fromKey, toKey } = useLoaderData<typeof loader>();
  const [rangeValue, setRangeValue] = useState(range);
  const [shown, setShown] = useState<string | null>(null);
  const open = files.find((f) => f.file === shown);

  return (
    <s-page heading="Export">
      <s-section heading="Period">
        <Form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={input} name="range" value={rangeValue} onChange={(e) => setRangeValue(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="month">This month</option>
            <option value="custom">Custom dates</option>
          </select>
          {rangeValue === "custom" ? (
            <>
              <label>From <input style={input} type="date" name="from" defaultValue={fromKey} /></label>
              <label>To <input style={input} type="date" name="to" defaultValue={toKey} /></label>
            </>
          ) : null}
          <select style={input} name="view" defaultValue={view}>
            <option value="gross">Profit: gross view</option>
            <option value="net">Profit: net view (delivered)</option>
          </select>
          <button style={btn} type="submit">Show</button>
        </Form>
        <s-paragraph>Files for {fromKey} to {toKey}. They open in Excel or Google Sheets. No customer names, phones or addresses are included.</s-paragraph>
      </s-section>

      <s-section heading="Files">
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {files.map((f) => (
              <tr key={f.file}>
                <td style={{ padding: "6px 10px" }}>{f.label}</td>
                <td style={{ padding: "6px 10px" }}>
                  <button style={btn} type="button" onClick={() => download(f.file, f.csv)}>Download</button>{" "}
                  <button style={btn} type="button" onClick={() => setShown(shown === f.file ? null : f.file)}>
                    {shown === f.file ? "Hide text" : "Show text"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {open ? (
          <div>
            <s-paragraph>If the download is blocked, select all in the box, copy, and paste into a spreadsheet.</s-paragraph>
            <textarea readOnly value={open.csv} style={{ width: "100%", height: 220, fontFamily: "monospace", fontSize: 12 }} onFocus={(e) => e.currentTarget.select()} />
          </div>
        ) : null}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
