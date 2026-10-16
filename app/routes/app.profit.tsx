import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { Form, Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getProfitReport } from "../services/profit.server";
import { dayKey, firstOfMonth, shiftDay } from "../lib/profit.ts";
import { formatTnd } from "../lib/money.ts";
import type { View } from "../lib/types.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const today = dayKey(new Date());

  const view: View = url.searchParams.get("view") === "net" ? "net" : "gross";
  const range = url.searchParams.get("range") ?? "30";

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

  const result = await getProfitReport(session.shop, fromKey, toKey, view);
  return { ...result, view, range };
};

const cell = { padding: "6px 10px", textAlign: "left" as const, borderBottom: "1px solid #e1e3e5" };
const num = { ...cell, textAlign: "right" as const };
const input = { padding: "6px 8px", border: "1px solid #8a8a8a", borderRadius: 6 };
const btn = { padding: "6px 12px", border: "1px solid #8a8a8a", borderRadius: 6, background: "#fff", cursor: "pointer" };

export default function ProfitPage() {
  const { report, feeOut, fxUsdTnd, fromKey, toKey, view, range } = useLoaderData<typeof loader>();
  const [rangeValue, setRangeValue] = useState(range);
  const t = report.totals;
  const rows = [...report.days].reverse();

  return (
    <s-page heading="Profit">
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
              <label>
                From <input style={input} type="date" name="from" defaultValue={fromKey} />
              </label>
              <label>
                To <input style={input} type="date" name="to" defaultValue={toKey} />
              </label>
            </>
          ) : null}
          <select style={input} name="view" defaultValue={view}>
            <option value="gross">Gross: everything not cancelled or returned</option>
            <option value="net">Net: delivered orders only</option>
          </select>
          <button style={btn} type="submit">
            Show
          </button>
        </Form>
        <s-paragraph>
          Showing {fromKey} to {toKey}, {view === "gross" ? "gross view" : "net view (delivered money only)"}. Days follow
          Tunisia time.
        </s-paragraph>
      </s-section>

      {feeOut === 0 || fxUsdTnd === 0 || report.ordersMissingCost > 0 ? (
        <s-section heading="To check">
          {feeOut === 0 ? (
            <s-paragraph>
              ⚠ The delivery fee is 0, so profit is overstated. <Link to="/app/costs">Set it on the Costs page</Link>.
            </s-paragraph>
          ) : null}
          {fxUsdTnd === 0 ? (
            <s-paragraph>
              ⚠ No USD to TND rate is set, so ad spend counts as 0. <Link to="/app/costs">Set the rate on the Costs page</Link>.
            </s-paragraph>
          ) : null}
          {report.ordersMissingCost > 0 ? (
            <s-paragraph>
              ⚠ {report.ordersMissingCost} order(s) contain products with no cost, so their profit is overstated.{" "}
              <Link to="/app/costs">Enter the product costs</Link>.
            </s-paragraph>
          ) : null}
        </s-section>
      ) : null}

      <s-section heading="Summary (TND)">
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            <tr><td style={cell}>Orders counted</td><td style={num}>{t.orders}</td></tr>
            <tr><td style={cell}>Revenue</td><td style={num}>{formatTnd(t.revenue)}</td></tr>
            <tr><td style={cell}>Product cost</td><td style={num}>{formatTnd(t.cogs)}</td></tr>
            <tr><td style={cell}>Delivery (incl. returned parcels)</td><td style={num}>{formatTnd(t.delivery)}</td></tr>
            <tr><td style={cell}>of which lost on {t.returnedParcels} returned parcel(s)</td><td style={num}>{formatTnd(t.returnsLoss)}</td></tr>
            <tr><td style={cell}>Other expenses</td><td style={num}>{formatTnd(t.expenses)}</td></tr>
            <tr><td style={cell}>Profit before ads</td><td style={num}>{formatTnd(t.profit)}</td></tr>
            <tr><td style={cell}>Ad spend (Meta)</td><td style={num}>{formatTnd(t.adSpend)}</td></tr>
            <tr><td style={cell}><strong>Profit after ads</strong></td><td style={num}><strong>{formatTnd(t.profitAfterAds)}</strong></td></tr>
            <tr><td style={cell}>Margin</td><td style={num}>{t.marginPct === null ? "-" : `${t.marginPct.toFixed(1)}%`}</td></tr>
            <tr><td style={cell}>Average order value</td><td style={num}>{t.avgOrderValue === null ? "-" : formatTnd(t.avgOrderValue)}</td></tr>
          </tbody>
        </table>
      </s-section>

      <s-section heading="Day by day (TND)">
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={cell}>Day</th>
              <th style={num}>Orders</th>
              <th style={num}>Revenue</th>
              <th style={num}>Product cost</th>
              <th style={num}>Delivery</th>
              <th style={num}>Expenses</th>
              <th style={num}>Before ads</th>
              <th style={num}>Ad spend</th>
              <th style={num}>After ads</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.date}>
                <td style={cell}>{d.date}</td>
                <td style={num}>{d.orders}</td>
                <td style={num}>{formatTnd(d.revenue)}</td>
                <td style={num}>{formatTnd(d.cogs)}</td>
                <td style={num}>{formatTnd(d.delivery)}</td>
                <td style={num}>{formatTnd(d.expenses)}</td>
                <td style={num}>{formatTnd(d.profit)}</td>
                <td style={num}>{formatTnd(d.adSpend)}</td>
                <td style={num}>{formatTnd(d.profitAfterAds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
