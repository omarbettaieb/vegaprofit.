import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useLoaderData } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getReconciliation } from "../services/reconcile.server";
import { dayKey, firstOfMonth, shiftDay } from "../lib/profit.ts";
import { formatTnd } from "../lib/money.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const today = dayKey(new Date());
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
  const data = await getReconciliation(session.shop, fromKey, toKey);
  return { ...data, range, fromKey, toKey };
};

const cell = { padding: "6px 10px", textAlign: "left" as const, borderBottom: "1px solid #e1e3e5" };
const num = { ...cell, textAlign: "right" as const };
const input = { padding: "6px 8px", border: "1px solid #8a8a8a", borderRadius: 6 };
const btn = { padding: "6px 12px", border: "1px solid #8a8a8a", borderRadius: 6, background: "#fff", cursor: "pointer" };

export default function ReconcilePage() {
  const d = useLoaderData<typeof loader>();
  const [rangeValue, setRangeValue] = useState(d.range);
  const t = d.totals;
  const over = t.real.value > 0 ? ((d.metaRevenueTnd - t.real.value) / t.real.value) * 100 : null;
  const row = (label: string, orders: number | string, value: number, strong = false, note?: string) => (
    <tr>
      <td style={cell}>{strong ? <strong>{label}</strong> : label}{note ? <div style={{ color: "#6d7175", fontSize: 12 }}>{note}</div> : null}</td>
      <td style={num}>{orders}</td>
      <td style={num}>{strong ? <strong>{formatTnd(value)}</strong> : formatTnd(value)}</td>
    </tr>
  );

  return (
    <s-page heading="Real revenue">
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
              <label>From <input style={input} type="date" name="from" defaultValue={d.fromKey} /></label>
              <label>To <input style={input} type="date" name="to" defaultValue={d.toKey} /></label>
            </>
          ) : null}
          <button style={btn} type="submit">Show</button>
        </Form>
        <s-paragraph>
          Orders are grouped by the day they were placed ({d.fromKey} to {d.toKey}), the same day Meta credits the purchase.
          Cancellations and returns are re-checked every time you open the app.
        </s-paragraph>
      </s-section>

      {d.ratesMissing ? (
        <s-section heading="To check">
          <s-paragraph>⚠ No USD to TND rate is set, so Meta revenue shows as 0. <Link to="/app/costs">Set it on the Costs page</Link>.</s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="Where the money went (TND)">
        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr><th style={cell} /><th style={num}>Orders</th><th style={num}>Value</th></tr>
          </thead>
          <tbody>
            {row("Meta says it sold", d.metaPurchases, d.metaRevenueTnd, false, "purchase value reported by Meta, converted to TND")}
            {row("Customers actually ordered", t.placed.orders, t.placed.value, false, "every Shopify order of the period")}
            {row("− Fake orders", t.fake.orders, -t.fake.value, false, "orders you marked fake")}
            {row("− Cancelled, returned, refunded", t.reversed.orders, -t.reversed.value, false, "includes the refunded part of partial refunds")}
            {row("= Real revenue (expected)", t.real.orders, t.real.value, true, "everything still standing")}
            {row("of which delivered", t.delivered.orders, t.delivered.value, false, "cash you can count on")}
            {row("of which still on the way", t.open.orders, t.open.value, false, "placed or in transit: can still turn into returns")}
          </tbody>
        </table>
        <s-paragraph>
          {over === null ? null : over > 5 ? `Meta overstates real revenue by ${Math.round(over)}%.` : "Meta's revenue is close to real revenue."}{" "}
          Real return on ad spend: {d.spendTnd > 0 ? (t.real.value / d.spendTnd).toFixed(2) : "-"} (Meta's own:{" "}
          {d.spendTnd > 0 ? (d.metaRevenueTnd / d.spendTnd).toFixed(2) : "-"}). Spend: {formatTnd(d.spendTnd)}.
        </s-paragraph>
        {d.provisional !== null && d.provisional > 0.2 ? (
          <s-paragraph>
            ⚠ {Math.round(d.provisional * 100)}% of this period's value is younger than {d.finalAfterDays} days, so it can still
            shrink as returns arrive. Reversals take about{" "}
            {d.lag.medianDays === null ? "?" : `${d.lag.medianDays} days (typical) and up to ${d.lag.p85Days} days (85% of cases)`} to show up.
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Day by day (TND)">
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={cell}>Day placed</th>
                <th style={num}>Meta purchases</th>
                <th style={num}>Meta revenue</th>
                <th style={num}>Orders</th>
                <th style={num}>Reversed</th>
                <th style={num}>Fake</th>
                <th style={num}>Real revenue</th>
                <th style={num}>Delivered</th>
              </tr>
            </thead>
            <tbody>
              {[...d.days].reverse().map((x) => (
                <tr key={x.date}>
                  <td style={cell}>{x.date}</td>
                  <td style={num}>{x.metaPurchases}</td>
                  <td style={num}>{formatTnd(x.metaRevenueTnd)}</td>
                  <td style={num}>{x.totals.placed.orders}</td>
                  <td style={num}>{x.totals.reversed.orders}</td>
                  <td style={num}>{x.totals.fake.orders}</td>
                  <td style={num}>{formatTnd(x.totals.real.value)}</td>
                  <td style={num}>{formatTnd(x.totals.delivered.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </s-section>

      <s-section heading={`Reversals posted in this period (${d.reversalsPosted.length})`}>
        <s-paragraph>
          Orders cancelled, voided or returned between {d.fromKey} and {d.toKey}, whenever they were placed. This is how
          Shopify's own sales report counts them, so use it to explain a difference with Shopify. Money refunded in the
          period: {formatTnd(d.refundedPosted)}.
        </s-paragraph>
        {d.reversalsPosted.length === 0 ? (
          <s-paragraph>None.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={cell}>Order</th><th style={cell}>Placed</th><th style={cell}>Reversed</th>
                  <th style={num}>Days later</th><th style={num}>Value</th><th style={cell}>Campaign</th>
                </tr>
              </thead>
              <tbody>
                {d.reversalsPosted.map((r) => (
                  <tr key={r.name}>
                    <td style={cell}>{r.name} {r.lifecycle === "RETURNED" ? "(returned)" : ""}</td>
                    <td style={cell}>{r.createdKey}{r.olderThanPeriod ? " ⚠ before period" : ""}</td>
                    <td style={cell}>{r.reversedKey}</td>
                    <td style={num}>{r.lagDays}</td>
                    <td style={num}>{formatTnd(r.value)}</td>
                    <td style={cell}>{r.campaign ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      <s-section heading={`Needs your attention: not delivered after ${d.staleDays}+ days (${d.stale.length})`}>
        <s-paragraph>
          These orders are still placed or in transit. Check with the courier, then mark them paid in Shopify when cash arrives.
        </s-paragraph>
        {d.stale.length === 0 ? (
          <s-paragraph>None, all orders are moving.</s-paragraph>
        ) : (
          <table style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr><th style={cell}>Order</th><th style={num}>Age (days)</th><th style={num}>Value</th><th style={cell}>Campaign</th></tr>
            </thead>
            <tbody>
              {d.stale.map((s) => (
                <tr key={s.name}>
                  <td style={cell}>{s.name}</td><td style={num}>{s.ageDays}</td><td style={num}>{formatTnd(s.value)}</td><td style={cell}>{s.campaign ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
