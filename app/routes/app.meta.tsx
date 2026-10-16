import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getMetaLines, getMetaStatus, syncMeta } from "../services/meta.server";
import type { MetaLevelName } from "../services/meta.server";
import { dayKey, firstOfMonth, shiftDay } from "../lib/profit.ts";
import { formatTnd } from "../lib/money.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const today = dayKey(new Date());
  const lv = url.searchParams.get("level");
  const level: MetaLevelName = lv === "adset" || lv === "ad" ? lv : "campaign";
  const range = url.searchParams.get("range") ?? "7";

  let fromKey = shiftDay(today, -6);
  if (range === "today") fromKey = today;
  else if (range === "30") fromKey = shiftDay(today, -29);
  else if (range === "month") fromKey = firstOfMonth(today);
  let toKey = today;
  if (range === "custom") {
    const f = url.searchParams.get("from") ?? "";
    const t = url.searchParams.get("to") ?? "";
    if (DATE_RE.test(f) && DATE_RE.test(t) && f <= t) {
      fromKey = f;
      toKey = t;
    }
  }

  const [data, status] = await Promise.all([getMetaLines(session.shop, level, fromKey, toKey), getMetaStatus(session.shop)]);
  return { ...data, status, level, range, fromKey, toKey };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const r = await syncMeta(session.shop);
    return { ok: true, message: `Meta synced: ${r.rows} ad-day rows for the last 60 days.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Sync failed" };
  }
};

const cell = { padding: "6px 10px", textAlign: "left" as const, borderBottom: "1px solid #e1e3e5" };
const num = { ...cell, textAlign: "right" as const };
const input = { padding: "6px 8px", border: "1px solid #8a8a8a", borderRadius: 6 };
const btn = { padding: "6px 12px", border: "1px solid #8a8a8a", borderRadius: 6, background: "#fff", cursor: "pointer" };

export default function MetaPage() {
  const { lines, rate, unattributedOrders, status, level, range, fromKey, toKey } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const syncing = nav.state === "submitting";
  const [rangeValue, setRangeValue] = useState(range);

  const totalSpend = lines.reduce((a, l) => a + l.spendTnd, 0);
  const totalOrders = lines.reduce((a, l) => a + l.trueOrders, 0);
  const totalMeta = lines.reduce((a, l) => a + l.metaPurchases, 0);
  const fmtCpa = (v: number | null) => (v === null ? "-" : formatTnd(v));

  return (
    <s-page heading="Meta ads">
      {result ? (
        <s-section>
          <s-paragraph>
            <strong>{result.ok ? "✓ " : "⚠ "}</strong>
            {result.message}
          </s-paragraph>
        </s-section>
      ) : null}

      {!status.configured ? (
        <s-section heading="Meta is not connected">
          <s-paragraph>
            Add META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in the Render environment, then come back and press Sync.
          </s-paragraph>
        </s-section>
      ) : null}
      {rate === 0 ? (
        <s-section heading="To check">
          <s-paragraph>
            ⚠ No USD to TND rate is set, so spend shows as 0. <Link to="/app/costs">Set the rate on the Costs page</Link>.
          </s-paragraph>
        </s-section>
      ) : null}
      {status.error ? (
        <s-section heading="Last sync error">
          <s-paragraph>⚠ {status.error}</s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="Period">
        <Form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={input} name="level" defaultValue={level}>
            <option value="campaign">Campaigns</option>
            <option value="adset">Ad sets</option>
            <option value="ad">Ads</option>
          </select>
          <select style={input} name="range" value={rangeValue} onChange={(e) => setRangeValue(e.target.value)}>
            <option value="today">Today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
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
          <button style={btn} type="submit">
            Show
          </button>
        </Form>
        <Form method="post" style={{ marginTop: 8 }}>
          <button style={btn} type="submit" disabled={syncing || !status.configured}>
            {syncing ? "Syncing..." : "Sync Meta now"}
          </button>{" "}
          Last sync: {status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString("en-GB", { timeZone: "Africa/Tunis" }) : "never"}
        </Form>
        <s-paragraph>
          Showing {fromKey} to {toKey}. Meta days follow your ad account timezone, orders follow Tunisia time.
        </s-paragraph>
      </s-section>

      <s-section heading="Spend against real orders (TND)">
        <s-paragraph>
          <strong>True orders</strong> are Shopify orders tied to the ad that are not cancelled, returned or refunded.{" "}
          <strong>Meta purchases</strong> is what Meta says it counted. A big gap between the two is what the next
          milestone investigates.
        </s-paragraph>
        {lines.length === 0 ? (
          <s-paragraph>No data for this period yet. Press "Sync Meta now".</s-paragraph>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cell}>{level === "campaign" ? "Campaign" : level === "adset" ? "Ad set" : "Ad"}</th>
                <th style={num}>Spend</th>
                <th style={num}>Meta purchases</th>
                <th style={num}>True orders</th>
                <th style={num}>Revenue</th>
                <th style={num}>Cost per true order</th>
                <th style={num}>Cost per Meta purchase</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td style={cell}>
                    {l.name}
                    {l.parent ? <div style={{ color: "#6d7175", fontSize: 12 }}>{l.parent}</div> : null}
                  </td>
                  <td style={num}>{formatTnd(l.spendTnd)}</td>
                  <td style={num}>{l.metaPurchases}</td>
                  <td style={num}>{l.trueOrders}</td>
                  <td style={num}>{formatTnd(l.revenueTnd)}</td>
                  <td style={num}>{fmtCpa(l.cpaTnd)}</td>
                  <td style={num}>{fmtCpa(l.metaCpaTnd)}</td>
                </tr>
              ))}
              <tr>
                <td style={cell}><strong>Total</strong></td>
                <td style={num}><strong>{formatTnd(totalSpend)}</strong></td>
                <td style={num}><strong>{totalMeta}</strong></td>
                <td style={num}><strong>{totalOrders}</strong></td>
                <td style={num}>{formatTnd(lines.reduce((a, l) => a + l.revenueTnd, 0))}</td>
                <td style={num}><strong>{fmtCpa(totalOrders ? totalSpend / totalOrders : null)}</strong></td>
                <td style={num}><strong>{fmtCpa(totalMeta ? totalSpend / totalMeta : null)}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
        <s-paragraph>
          {unattributedOrders} active order(s) in this period are not tied to any ad (direct, organic or missing tracking
          data) and are not in the table.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
