import { Form, Link, useNavigation } from "react-router";
import type { TruthLine } from "../services/meta.server";
import type { DayCheck } from "../lib/truth.ts";
import { Badge, ClaimProof, DatePop, Empty, Kpis, Notice, Page, Section, Seg, TableWrap, Trend } from "../ui/kit.tsx";
import type { Tone } from "../ui/kit.tsx";
import { roas, tnd, tndOrDash, when, whole } from "../ui/format.ts";

export interface MetaProps {
  base: string;
  lines: TruthLine[];
  rate: number;
  unattributedOrders: number;
  ordersMissingCost: number;
  status: { configured: boolean; lastSyncAt: string | null; error: string | null };
  checks: DayCheck[];
  level: "campaign" | "adset" | "ad";
  range: string;
  fromKey: string;
  toKey: string;
  duplicateStart: string;
  readOnly?: boolean;
  notice?: { ok: boolean; message: string } | null;
}

const TRACK: Record<string, [Tone, string]> = { GREEN: ["green", "Matches"], AMBER: ["amber", "Check"], RED: ["red", "Broken"], LOW: ["grey", "Too few"] };

export default function MetaView(p: MetaProps) {
  const nav = useNavigation();
  const syncing = nav.state === "submitting";
  const { lines } = p;
  const sum = (f: (l: TruthLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const spend = sum((l) => l.spendTnd);
  const claimed = sum((l) => l.metaPurchases);
  const proven = sum((l) => l.trueOrders);
  const unexplained = sum((l) => l.unexplained);
  const label = p.level === "campaign" ? "Campaign" : p.level === "adset" ? "Ad set" : "Ad";
  const days = p.checks.map((d) => ({ date: d.date, claim: d.metaPurchases, proof: d.shopifyOrders }));
  const dupDays = p.checks.filter((d) => d.duplicates > 0);

  return (
    <Page
      title="Meta ads"
      lede={`${p.fromKey} to ${p.toKey}. Meta days follow your ad account timezone, orders follow Tunisia time.`}
      actions={
        <>
          <Seg name="level" label="Level" current={p.level} options={[["campaign", "Campaigns"], ["adset", "Ad sets"], ["ad", "Ads"]]} />
          <Seg name="range" label="Period" current={p.range} options={[["today", "Today"], ["7", "7 days"], ["30", "30 days"], ["month", "This month"]]} />
          <DatePop from={p.fromKey} to={p.toKey} keep={{ level: p.level }} />
        </>
      }
    >
      {p.notice ? <Notice tone={p.notice.ok ? "good" : "bad"}>{p.notice.message}</Notice> : null}
      {!p.status.configured ? <Notice tone="warn">Meta is not connected. Add META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in the Render environment, then press Sync.</Notice> : null}
      {p.rate === 0 ? (
        <Notice tone="warn">
          No USD to TND rate is set, so spend shows as 0. <Link to={`${p.base}/costs`}>Set the rate on the Costs page</Link>.
        </Notice>
      ) : null}
      {p.status.error ? <Notice tone="bad">Last sync error: {p.status.error}</Notice> : null}
      {p.ordersMissingCost > 0 ? (
        <Notice tone="warn">
          {p.ordersMissingCost} order(s) have products with no cost, so break-even is overstated. <Link to={`${p.base}/costs`}>Enter the product costs</Link>.
        </Notice>
      ) : null}

      <Kpis
        items={[
          { label: "Ad spend", value: whole(spend), unit: "TND", sub: `${p.unattributedOrders} orders not tied to any ad` },
          { label: "Meta says", value: String(claimed), unit: "purchases", sub: claimed > 0 ? `${tnd(spend / claimed)} each` : undefined },
          { label: "Shopify proves", value: String(proven), unit: "orders", sub: proven > 0 ? `${tnd(spend / proven)} each` : undefined },
          { label: "No order behind them", value: String(unexplained), unit: "purchases", tone: unexplained > 0 ? "neg" : undefined, sub: "duplicates, view credit, untracked" },
        ]}
      />

      <Section title="Claimed against proven" note="Hatched is what Meta reports. Solid is what is left after cancelled, returned and fake orders are removed.">
        {lines.length === 0 ? (
          <Empty>No data for this period yet. {p.readOnly ? "" : 'Press "Sync Meta now".'}</Empty>
        ) : (
          <ClaimProof rows={lines.slice(0, 8).map((l) => ({ key: l.key, label: l.name, sub: l.parent, claimed: l.metaPurchases, proven: l.trueOrders }))} />
        )}
      </Section>

      <Section
        title="Truth table (TND)"
        right={
          p.readOnly ? null : (
            <Form method="post" className="vp-bar-tools">
              <span style={{ color: "var(--mute)", fontSize: 13 }}>Last sync {when(p.status.lastSyncAt)}</span>
              <button type="submit" className="vp-primary" disabled={syncing || !p.status.configured}>
                {syncing ? "Syncing..." : "Sync Meta now"}
              </button>
            </Form>
          )
        }
        note="True orders are the Shopify orders tied to the ad, minus cancelled, returned and fake ones. Break-even cost is what one true order leaves before ads, after product cost, delivery and returned parcels. Spend per true order above it loses money."
      >
        {lines.length === 0 ? null : (
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>{label}</th>
                  <th style={{ textAlign: "right" }}>Spend</th>
                  <th style={{ textAlign: "right" }}>Meta says</th>
                  <th style={{ textAlign: "right" }}>Orders</th>
                  <th style={{ textAlign: "right" }}>Reversed</th>
                  <th style={{ textAlign: "right" }}>Fake</th>
                  <th style={{ textAlign: "right" }}>True orders</th>
                  <th style={{ textAlign: "right" }}>No order</th>
                  <th>Tracking</th>
                  <th style={{ textAlign: "right" }}>Cost / order</th>
                  <th style={{ textAlign: "right" }}>Break-even</th>
                  <th style={{ textAlign: "right" }}>ROAS</th>
                  <th style={{ textAlign: "right" }} title="Break-even ROAS">BE ROAS</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const [tone, text] = TRACK[l.trackingStatus];
                  const bad = l.cpaVsBreakEven !== null && l.cpaVsBreakEven > 1;
                  return (
                    <tr key={l.key}>
                      <td>
                        <span className="vp-strong">{l.name}</span>
                        {l.parent ? <span className="vp-sub">{l.parent}</span> : null}
                      </td>
                      <td style={{ textAlign: "right" }}>{tnd(l.spendTnd)}</td>
                      <td style={{ textAlign: "right" }} className="vp-dim">{l.metaPurchases}</td>
                      <td style={{ textAlign: "right" }}>{l.shopifyOrders}</td>
                      <td style={{ textAlign: "right" }}>{l.reversedOrders}</td>
                      <td style={{ textAlign: "right" }}>{l.excludedOrders}</td>
                      <td style={{ textAlign: "right" }} className="vp-strong">{l.trueOrders}</td>
                      <td style={{ textAlign: "right" }} className={l.unexplained > 0 ? "vp-neg" : ""}>{l.unexplained}</td>
                      <td><Badge tone={tone}>{text}</Badge></td>
                      <td style={{ textAlign: "right" }} className={bad ? "vp-neg vp-strong" : ""}>{tndOrDash(l.trueCpa)}</td>
                      <td style={{ textAlign: "right" }}>{tndOrDash(l.breakEvenCpa)}</td>
                      <td style={{ textAlign: "right" }}>{roas(l.trueRoas)}</td>
                      <td style={{ textAlign: "right" }}>{roas(l.breakEvenRoas)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td style={{ textAlign: "right" }}>{tnd(spend)}</td>
                  <td style={{ textAlign: "right" }}>{claimed}</td>
                  <td style={{ textAlign: "right" }}>{sum((l) => l.shopifyOrders)}</td>
                  <td style={{ textAlign: "right" }}>{sum((l) => l.reversedOrders)}</td>
                  <td style={{ textAlign: "right" }}>{sum((l) => l.excludedOrders)}</td>
                  <td style={{ textAlign: "right" }}>{proven}</td>
                  <td style={{ textAlign: "right" }}>{unexplained}</td>
                  <td />
                  <td style={{ textAlign: "right" }}>{proven ? tnd(spend / proven) : "-"}</td>
                  <td />
                  <td style={{ textAlign: "right" }}>{spend ? roas(sum((l) => l.revenueTnd) / spend) : "-"}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section
        title={`Duplicate check by day (from ${p.duplicateStart})`}
        note="Meta cannot sell more than the orders that exist. A day where Meta reports more purchases than Shopify has orders (any source, any status) proves duplicate purchase events."
      >
        {p.checks.length === 0 ? (
          <Empty>Nothing to show yet for this period.</Empty>
        ) : (
          <>
            <Trend days={days} />
            <div className="vp-legend" style={{ marginTop: 10 }}>
              <span><i className="claim" />Meta purchases</span>
              <span><i className="proof" />Shopify orders, all sources</span>
              <span>{dupDays.length === 0 ? "No day with proven duplicates." : `${dupDays.length} day(s) with proven duplicates, ${dupDays.reduce((a, d) => a + d.duplicates, 0)} purchases in total.`}</span>
            </div>
            {dupDays.length > 0 ? (
              <TableWrap>
                <table>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th style={{ textAlign: "right" }}>Meta purchases</th>
                      <th style={{ textAlign: "right" }}>Shopify orders</th>
                      <th style={{ textAlign: "right" }}>Proven duplicates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...dupDays].reverse().map((d) => (
                      <tr key={d.date}>
                        <td>{d.date}</td>
                        <td style={{ textAlign: "right" }}>{d.metaPurchases}</td>
                        <td style={{ textAlign: "right" }}>{d.shopifyOrders}</td>
                        <td style={{ textAlign: "right" }} className="vp-neg vp-strong">{d.duplicates}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : null}
          </>
        )}
      </Section>
    </Page>
  );
}
