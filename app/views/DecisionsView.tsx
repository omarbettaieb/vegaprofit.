import { Form, Link, useFetcher } from "react-router";
import type { DecisionLine } from "../services/decisions.server";
import { Badge, Empty, Kpis, Notice, Page, Section, Seg, TableWrap } from "../ui/kit.tsx";
import { tnd, tndOrDash } from "../ui/format.ts";
import { VERDICT_LABEL, VERDICT_TONE } from "./HomeView.tsx";

export const FIELDS: [string, string][] = [
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

const LEVEL_DB: Record<string, string> = { campaign: "CAMPAIGN", adset: "ADSET", ad: "AD" };
const ORDER = ["KILL", "PAUSE", "SCALE", "CALENDAR", "WATCH"] as const;

export interface DecisionsProps {
  base: string;
  lines: DecisionLine[];
  referenceBreakEven: number | null;
  windowDays: number;
  values: Record<string, number>;
  ratesMissing: boolean;
  level: "campaign" | "adset" | "ad";
  readOnly?: boolean;
  notice?: { ok: boolean; message: string } | null;
}

export default function DecisionsView(p: DecisionsProps) {
  const fetcher = useFetcher();
  const label = p.level === "campaign" ? "Campaign" : p.level === "adset" ? "Ad set" : "Ad";
  const counts = ORDER.map((v) => ({ v, n: p.lines.filter((l) => l.result.verdict === v).length }));
  return (
    <Page
      title="Decisions"
      lede={`One verdict per ${label.toLowerCase()}, judged on the last ${p.windowDays} days. The app only advises: it never changes your ads.`}
      actions={<Seg name="level" label="Level" current={p.level} options={[["campaign", "Campaigns"], ["adset", "Ad sets"], ["ad", "Ads"]]} />}
    >
      {p.notice ? <Notice tone={p.notice.ok ? "good" : "bad"}>{p.notice.message}</Notice> : null}
      {p.ratesMissing ? (
        <Notice tone="warn">
          No USD to TND rate is set, so spend counts as 0 and verdicts are meaningless. <Link to={`${p.base}/costs`}>Set it on the Costs page</Link>.
        </Notice>
      ) : null}

      <Kpis items={counts.map(({ v, n }) => ({ label: VERDICT_LABEL[v], value: String(n), sub: v === "KILL" ? "stop spending" : v === "PAUSE" ? "pause and fix" : v === "SCALE" ? "raise the budget" : v === "CALENDAR" ? "do nothing yet" : "not enough proof" }))} />

      <Section
        title={`One verdict per ${label.toLowerCase()}`}
        note={`Costs are compared with each one's own break-even cost. When it has no orders yet, the account average ${p.referenceBreakEven === null ? "(not available yet)" : `(${tnd(p.referenceBreakEven)} TND)`} is used.`}
        right={<Link to={`${p.base}/calendar`}>Open the calendar</Link>}
      >
        {p.lines.length === 0 ? (
          <Empty>Nothing to judge yet. Sync Meta on the Meta ads page first.</Empty>
        ) : (
          <TableWrap>
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>{label}</th>
                  <th>Verdict</th>
                  <th>Why</th>
                  <th style={{ textAlign: "right" }}>Spend</th>
                  <th style={{ textAlign: "right" }}>True orders</th>
                  <th style={{ textAlign: "right" }}>Cost per order</th>
                  <th style={{ textAlign: "right" }}>Break-even</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <span className="vp-strong">{l.name}</span>
                      {l.parent ? <span className="vp-sub">{l.parent}</span> : null}
                    </td>
                    <td>
                      <Badge tone={VERDICT_TONE[l.result.verdict]}>{VERDICT_LABEL[l.result.verdict]}</Badge>
                    </td>
                    <td className="wrap" style={{ minWidth: 260 }}>
                      {l.result.reason}
                      {l.result.scaleSuggestion ? <span className="vp-sub vp-pos vp-strong">{l.result.scaleSuggestion}</span> : null}
                    </td>
                    <td style={{ textAlign: "right" }}>{tnd(l.spendTnd)}</td>
                    <td style={{ textAlign: "right" }}>{l.trueOrders}</td>
                    <td style={{ textAlign: "right" }}>
                      {tndOrDash(l.trueCpa)}
                      {l.result.cpaMultiple !== null ? <span className="vp-sub">{l.result.cpaMultiple.toFixed(2)}x break-even</span> : null}
                    </td>
                    <td style={{ textAlign: "right" }}>{tndOrDash(l.breakEven)}</td>
                    <td>
                      {l.result.nextReview ? <span className="vp-sub" style={{ marginBottom: 4 }}>{l.result.nextReview}</span> : null}
                      {p.readOnly ? null : (
                        <fetcher.Form method="post" action={`${p.base}/calendar`} style={{ display: "flex", gap: 6 }}>
                          <input type="hidden" name="intent" value="addEvent" />
                          <input type="hidden" name="kind" value="review" />
                          <input type="hidden" name="level" value={LEVEL_DB[p.level]} />
                          <input type="hidden" name="entityMetaId" value={l.key} />
                          <input type="hidden" name="title" value={`Review: ${l.name}`} />
                          <input type="date" name="date" required aria-label={`Review date for ${l.name}`} style={{ width: 138 }} />
                          <button type="submit">Set</button>
                        </fetcher.Form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Thresholds" note={p.readOnly ? "Every number below can be changed in the real app." : "You can change every number. The verdicts above use them on the next page load."}>
        {p.readOnly ? (
          <div className="vp-formgrid">
            {FIELDS.map(([key, text]) => (
              <label key={key} style={{ borderBottom: "1px solid var(--line2)", padding: "4px 0" }}>
                <span>{text}</span>
                <strong>{p.values[key]}</strong>
              </label>
            ))}
          </div>
        ) : (
          <Form method="post" className="vp-formgrid">
            {FIELDS.map(([key, text]) => (
              <label key={key}>
                <span>{text}</span>
                <input name={key} defaultValue={String(p.values[key] ?? "")} inputMode="decimal" />
              </label>
            ))}
            <div>
              <button type="submit" className="vp-primary">Save thresholds</button>
            </div>
          </Form>
        )}
      </Section>
    </Page>
  );
}
