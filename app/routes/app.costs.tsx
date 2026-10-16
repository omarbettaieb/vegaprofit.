import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { addExpense, deleteExpense, getCostsPage, saveFees, saveFxRate, saveVariantCost } from "../services/costs.server";
import { formatTnd, parseAmount } from "../lib/money.ts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return getCostsPage(session.shop);
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (s: string) => new Date(`${s}T00:00:00+01:00`); // Tunisia: UTC+1, no daylight saving

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "saveCost") {
    const variantId = String(form.get("variantId") ?? "");
    const cost = parseAmount(form.get("unitCost"));
    if (!variantId || cost === null) return { ok: false, message: "Enter the cost as a number, for example 18.5" };
    await saveVariantCost(shop, variantId, String(form.get("title") ?? ""), cost);
    return { ok: true, message: "Cost saved" };
  }

  if (intent === "saveFees") {
    const out = parseAmount(form.get("feeOut"));
    const back = parseAmount(form.get("feeReturn"));
    if (out === null || back === null) return { ok: false, message: "Both fees must be numbers (0 is allowed)" };
    await saveFees(shop, out, back);
    return { ok: true, message: "Delivery fees saved" };
  }

  if (intent === "saveFx") {
    const rate = parseAmount(form.get("fx"));
    if (rate === null || rate <= 0) return { ok: false, message: "Enter the rate as a number above 0, for example 3.1" };
    await saveFxRate(shop, rate);
    return { ok: true, message: "Exchange rate saved" };
  }

  if (intent === "addExpense") {
    const label = String(form.get("label") ?? "").trim();
    const amount = parseAmount(form.get("amount"));
    const recurrence = String(form.get("recurrence") ?? "one_off");
    const start = String(form.get("startDate") ?? "");
    const end = String(form.get("endDate") ?? "");
    if (!label || amount === null || !DATE_RE.test(start)) {
      return { ok: false, message: "An expense needs a name, an amount and a start date" };
    }
    if (recurrence !== "one_off" && recurrence !== "monthly" && recurrence !== "weekly") {
      return { ok: false, message: "Unknown recurrence" };
    }
    if (end && !DATE_RE.test(end)) return { ok: false, message: "End date is not valid" };
    await addExpense(shop, {
      label,
      amount,
      recurrence,
      startDate: toDate(start),
      endDate: end ? toDate(end) : null,
    });
    return { ok: true, message: "Expense added" };
  }

  if (intent === "deleteExpense") {
    await deleteExpense(shop, String(form.get("id") ?? ""));
    return { ok: true, message: "Expense removed" };
  }

  return { ok: false, message: "Unknown action" };
};

const cell = { padding: "6px 10px", textAlign: "left" as const, borderBottom: "1px solid #e1e3e5" };
const input = { padding: "6px 8px", border: "1px solid #8a8a8a", borderRadius: 6, width: 110 };
const btn = { padding: "6px 12px", border: "1px solid #8a8a8a", borderRadius: 6, background: "#fff", cursor: "pointer" };
const RECURRENCE: Record<string, string> = { one_off: "One time", monthly: "Every month", weekly: "Every week" };

export default function CostsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data;

  return (
    <s-page heading="Costs">
      {result ? (
        <s-section>
          <s-paragraph>
            <strong>{result.ok ? "✓ " : "⚠ "}</strong>
            {result.message}
          </s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="Delivery fees (TND)">
        <s-paragraph>
          The courier fee is charged to every parcel that leaves. A returned or refused parcel costs the outbound fee
          plus the return fee, and the product goes back to stock.
        </s-paragraph>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="saveFees" />
          <label>
            Fee per shipped parcel{" "}
            <input style={input} name="feeOut" defaultValue={String(data.feeOut)} inputMode="decimal" />
          </label>{" "}
          <label>
            Extra fee when returned{" "}
            <input style={input} name="feeReturn" defaultValue={String(data.feeReturn)} inputMode="decimal" />
          </label>{" "}
          <button style={btn} type="submit">
            Save fees
          </button>
        </fetcher.Form>
        {data.feeOut === 0 ? (
          <s-paragraph>⚠ The delivery fee is 0, so profit is overstated until you set it.</s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Meta exchange rate (TND per 1 USD)">
        <s-paragraph>
          Your Meta account bills in USD. This rate turns Meta spend into TND everywhere in the app. Changing it
          re-prices all past spend at the new rate.
        </s-paragraph>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="saveFx" />
          <label>
            1 USD ={" "}
            <input style={input} name="fx" defaultValue={data.fxUsdTnd ? String(data.fxUsdTnd) : ""} placeholder="e.g. 3.1" inputMode="decimal" />{" "}
            TND
          </label>{" "}
          <button style={btn} type="submit">
            Save rate
          </button>
        </fetcher.Form>
        {!data.fxUsdTnd ? <s-paragraph>⚠ No rate yet, so ad spend shows as 0 until you set it.</s-paragraph> : null}
      </s-section>

      <s-section heading="Product costs (TND per unit)">
        <s-paragraph>
          What each unit costs you to buy. {data.missingCount} of {data.variants.length} products have no cost yet; their
          orders show profit without product cost. A later change applies from today, so past orders keep the old cost.
        </s-paragraph>
        {data.variants.length === 0 ? (
          <s-paragraph>No products yet. Import your orders first.</s-paragraph>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cell}>Product</th>
                <th style={cell}>Units sold</th>
                <th style={cell}>Last price</th>
                <th style={cell}>Cost per unit</th>
                <th style={cell}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {data.variants.map((v) => (
                <tr key={v.variantId}>
                  <td style={cell}>
                    {v.title}
                    {v.sku ? ` (${v.sku})` : ""}
                  </td>
                  <td style={cell}>{v.unitsSold}</td>
                  <td style={cell}>{formatTnd(v.lastPrice)}</td>
                  <td style={cell}>
                    <fetcher.Form method="post" style={{ display: "flex", gap: 6 }}>
                      <input type="hidden" name="intent" value="saveCost" />
                      <input type="hidden" name="variantId" value={v.variantId} />
                      <input type="hidden" name="title" value={v.title} />
                      <input
                        style={input}
                        name="unitCost"
                        defaultValue={v.currentCost === null ? "" : String(v.currentCost)}
                        placeholder="e.g. 18.5"
                        inputMode="decimal"
                      />
                      <button style={btn} type="submit">
                        Save
                      </button>
                    </fetcher.Form>
                  </td>
                  <td style={cell}>
                    {v.currentCost === null ? "-" : `${formatTnd(v.lastPrice - v.currentCost)} (${Math.round(((v.lastPrice - v.currentCost) / (v.lastPrice || 1)) * 100)}%)`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section heading="Other expenses (TND)">
        <s-paragraph>
          Rent, salaries, apps, packaging, anything that is not product cost, delivery or ad spend. Monthly amounts are
          spread evenly over the days of the month.
        </s-paragraph>
        {data.expenses.length > 0 ? (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cell}>Name</th>
                <th style={cell}>Amount</th>
                <th style={cell}>Repeats</th>
                <th style={cell}>From</th>
                <th style={cell}>Until</th>
                <th style={cell} />
              </tr>
            </thead>
            <tbody>
              {data.expenses.map((e) => (
                <tr key={e.id}>
                  <td style={cell}>{e.label}</td>
                  <td style={cell}>{formatTnd(e.amount)}</td>
                  <td style={cell}>{RECURRENCE[e.recurrence] ?? e.recurrence}</td>
                  <td style={cell}>{e.startDate}</td>
                  <td style={cell}>{e.endDate ?? "no end"}</td>
                  <td style={cell}>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="deleteExpense" />
                      <input type="hidden" name="id" value={e.id} />
                      <button style={btn} type="submit">
                        Remove
                      </button>
                    </fetcher.Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <s-paragraph>No expenses yet.</s-paragraph>
        )}
        <fetcher.Form method="post" style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="hidden" name="intent" value="addExpense" />
          <input style={{ ...input, width: 160 }} name="label" placeholder="Name, e.g. Rent" />
          <input style={input} name="amount" placeholder="Amount" inputMode="decimal" />
          <select style={input} name="recurrence" defaultValue="monthly">
            <option value="one_off">One time</option>
            <option value="monthly">Every month</option>
            <option value="weekly">Every week</option>
          </select>
          <label>
            From <input style={input} type="date" name="startDate" />
          </label>
          <label>
            Until (optional) <input style={input} type="date" name="endDate" />
          </label>
          <button style={btn} type="submit">
            Add expense
          </button>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
