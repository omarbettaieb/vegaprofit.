import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getDecisions, saveRules } from "../services/decisions.server";
import type { MetaLevelName } from "../services/meta.server";
import { formatTnd, parseAmount } from "../lib/money.ts";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const lv = new URL(request.url).searchParams.get("level");
  const level: MetaLevelName = lv === "adset" || lv === "ad" ? lv : "campaign";
  const data = await getDecisions(session.shop, level);
  return { ...data, level };
};

const FIELDS: [string, string][] = [
  ["verdict_window_days", "Judge the last N days"],
  ["min_orders", "True orders needed before judging by cost per order"],
  ["kill_zero_mult", "KILL: spend (x break-even) with 0 orders"],
  ["kill_cpa_mult", "KILL: cost per order above (x break-even)"],
  ["pause_cpa_mult", "PAUSE: cost per order above (x break-even)"],
  ["scale_cpa_mult", "SCALE: cost per order at or below (x break-even)"],
  ["early_spend_mult", "Early PAUSE: spend above (x break-even)"],
  ["early_cpa_mult", "Early PAUSE: and cost per order above (x break-even)"],
  ["learning_days", "Learning window (days, no edits)"],
  ["scale_step_pct", "Scale step (%)"],
  ["scale_cooldown_hours", "Hours between scale suggestions"],
  ["end_soon_days", "Campaign ends within N days: let it finish"],
  ["reversal_rise_points", "Reversal rate rise that blocks scaling (0.15 = 15 points)"],
  ["tracking_amber_ratio", "Tracking orange: Meta / Shopify above"],
  ["tracking_red_ratio", "Tracking red: Meta / Shopify above"],
];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const values: Record<string, number> = {};
  for (const [key] of FIELDS) {
    const n = parseAmount(form.get(key));
    if (n === null || n < 0) return { ok: false, message: `"${key}" must be a number` };
    values[key] = n;
  }
  await saveRules(session.shop, values);
  return { ok: true, message: "Thresholds saved" };
};

const cell = { padding: "6px 10px", textAlign: "left" as const, borderBottom: "1px solid #e1e3e5", verticalAlign: "top" as const };
const num = { ...cell, textAlign: "right" as const };
const input = { padding: "6px 8px", border: "1px solid #8a8a8a", borderRadius: 6, width: 90 };
const btn = { padding: "6px 12px", border: "1px solid #8a8a8a", borderRadius: 6, background: "#fff", cursor: "pointer" };
const BADGE: Record<string, { bg: string; fg: string }> = {
  KILL: { bg: "#b42318", fg: "#fff" },
  PAUSE: { bg: "#f79009", fg: "#000" },
  SCALE: { bg: "#067647", fg: "#fff" },
  CALENDAR: { bg: "#175cd3", fg: "#fff" },
  WATCH: { bg: "#d0d5dd", fg: "#000" },
};
const LEVEL_DB: Record<string, string> = { campaign: "CAMPAIGN", adset: "ADSET", ad: "AD" };

export default function DecisionsPage() {
  const { lines, referenceBreakEven, windowDays, values, ratesMissing, level } = useLoaderData<typeof loader>();
  const saved = useActionData<typeof action>();
  const fetcher = useFetcher();
  const fmt = (v: number | null) => (v === null ? "-" : formatTnd(v));

  return (
    <s-page heading="Decisions">
      {saved ? (
        <s-section>
          <s-paragraph>
            <strong>{saved.ok ? "✓ " : "⚠ "}</strong>
            {saved.message}
          </s-paragraph>
        </s-section>
      ) : null}
      {ratesMissing ? (
        <s-section heading="To check">
          <s-paragraph>
            ⚠ No USD to TND rate is set, so spend counts as 0 and verdicts are meaningless. <Link to="/app/costs">Set it on the Costs page</Link>.
          </s-paragraph>
        </s-section>
      ) : null}

      <s-section heading="One verdict per entity">
        <Form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select style={{ ...input, width: "auto" }} name="level" defaultValue={level}>
            <option value="campaign">Campaigns</option>
            <option value="adset">Ad sets</option>
            <option value="ad">Ads</option>
          </select>
          <button style={btn} type="submit">
            Show
          </button>
        </Form>
        <s-paragraph>
          Judged on the last {windowDays} days. Costs are compared with each entity's own break-even cost (average profit
          one true order leaves before ads); when it has no orders yet, the account average{" "}
          {referenceBreakEven === null ? "(not available yet)" : `(${formatTnd(referenceBreakEven)})`} is used.{" "}
          <Link to="/app/calendar">Open the calendar</Link>.
        </s-paragraph>
        {lines.length === 0 ? (
          <s-paragraph>Nothing to judge yet. Sync Meta on the Meta ads page first.</s-paragraph>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={cell}>{level === "campaign" ? "Campaign" : level === "adset" ? "Ad set" : "Ad"}</th>
                  <th style={cell}>Verdict</th>
                  <th style={cell}>Why</th>
                  <th style={num}>Spend</th>
                  <th style={num}>True orders</th>
                  <th style={num}>True cost</th>
                  <th style={num}>Break-even</th>
                  <th style={cell}>Review</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const b = BADGE[l.result.verdict];
                  return (
                    <tr key={l.key}>
                      <td style={cell}>
                        {l.name}
                        {l.parent ? <div style={{ color: "#6d7175", fontSize: 12 }}>{l.parent}</div> : null}
                      </td>
                      <td style={cell}>
                        <span style={{ background: b.bg, color: b.fg, padding: "2px 8px", borderRadius: 10, fontWeight: 600, fontSize: 12 }}>
                          {l.result.verdict}
                        </span>
                      </td>
                      <td style={cell}>
                        {l.result.reason}
                        {l.result.scaleSuggestion ? <div><strong>→ {l.result.scaleSuggestion}</strong></div> : null}
                      </td>
                      <td style={num}>{formatTnd(l.spendTnd)}</td>
                      <td style={num}>{l.trueOrders}</td>
                      <td style={num}>{fmt(l.trueCpa)}</td>
                      <td style={num}>{fmt(l.breakEven)}</td>
                      <td style={cell}>
                        {l.result.nextReview ? <div>{l.result.nextReview}</div> : null}
                        <fetcher.Form method="post" action="/app/calendar" style={{ display: "flex", gap: 4 }}>
                          <input type="hidden" name="intent" value="addEvent" />
                          <input type="hidden" name="kind" value="review" />
                          <input type="hidden" name="level" value={LEVEL_DB[level]} />
                          <input type="hidden" name="entityMetaId" value={l.key} />
                          <input type="hidden" name="title" value={`Review: ${l.name}`} />
                          <input style={{ ...input, width: 130 }} type="date" name="date" required />
                          <button style={btn} type="submit">
                            Set
                          </button>
                        </fetcher.Form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <s-paragraph>
          KILL = stop spending. PAUSE = pause and fix. WATCH = not enough proof either way. CALENDAR = do nothing until the
          date shown. SCALE = raise the budget by the suggested step. The app never changes your ads; it only tells you.
        </s-paragraph>
      </s-section>

      <s-section heading="Thresholds (you can change every number)">
        <Form method="post" style={{ display: "grid", gap: 6, maxWidth: 640 }}>
          {FIELDS.map(([key, label]) => (
            <label key={key} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span>{label}</span>
              <input style={input} name={key} defaultValue={String(values[key] ?? "")} inputMode="decimal" />
            </label>
          ))}
          <div>
            <button style={btn} type="submit">
              Save thresholds
            </button>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
