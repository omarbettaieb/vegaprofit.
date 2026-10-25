import { Link } from "react-router";
import type { getReconciliation } from "../services/reconcile.server";
import { DatePop, Empty, Flow, Kpis, Notice, Page, Section, Seg, TableWrap, Trend } from "../ui/kit.tsx";
import { tnd, whole } from "../ui/format.ts";

type Data = Awaited<ReturnType<typeof getReconciliation>>;
export type ReconcileProps = Data & { base: string; range: string; fromKey: string; toKey: string };

export default function ReconcileView(d: ReconcileProps) {
  const t = d.totals;
  const over = t.real.value > 0 ? ((d.metaRevenueTnd - t.real.value) / t.real.value) * 100 : null;
  const realRoas = d.spendTnd > 0 ? t.real.value / d.spendTnd : null;
  const metaRoas = d.spendTnd > 0 ? d.metaRevenueTnd / d.spendTnd : null;
  return (
    <Page
      title="Real revenue"
      lede={`Orders grouped by the day they were placed (${d.fromKey} to ${d.toKey}), the same day Meta credits the purchase. Cancellations and returns are re-checked every time the app opens.`}
      actions={
        <>
          <Seg name="range" label="Period" current={d.range} options={[["7", "7 days"], ["30", "30 days"], ["60", "60 days"], ["month", "This month"]]} />
          <DatePop from={d.fromKey} to={d.toKey} keep={{}} />
        </>
      }
    >
      {d.ratesMissing ? (
        <Notice tone="warn">
          No USD to TND rate is set, so Meta revenue shows as 0. <Link to={`${d.base}/costs`}>Set it on the Costs page</Link>.
        </Notice>
      ) : null}
      {d.provisional !== null && d.provisional > 0.2 ? (
        <Notice tone="warn">
          {Math.round(d.provisional * 100)}% of this period's value is younger than {d.finalAfterDays} days, so it can still shrink as returns arrive. Reversals take about{" "}
          {d.lag.medianDays === null ? "?" : `${d.lag.medianDays} days (typical) and up to ${d.lag.p85Days} days (85% of cases)`} to show up.
        </Notice>
      ) : null}

      <Kpis
        items={[
          { label: "Meta says it sold", value: whole(d.metaRevenueTnd), unit: "TND", sub: `${d.metaPurchases} purchases` },
          { label: "Real revenue", value: whole(t.real.value), unit: "TND", sub: `${t.real.orders} orders still standing` },
          { label: "Already delivered", value: whole(t.delivered.value), unit: "TND", sub: `${t.delivered.orders} orders, cash you can count on` },
          { label: "Real return on spend", value: realRoas === null ? "-" : realRoas.toFixed(2), sub: metaRoas === null ? undefined : `Meta claims ${metaRoas.toFixed(2)}`, tone: realRoas !== null && metaRoas !== null && realRoas < metaRoas * 0.8 ? "neg" : undefined },
        ]}
      />

      <Section
        title="Where the money went (TND)"
        note={
          over === null
            ? undefined
            : over > 5
              ? `Meta overstates real revenue by ${Math.round(over)}%. Spend in the period: ${tnd(d.spendTnd)}.`
              : `Meta's revenue is close to real revenue. Spend in the period: ${tnd(d.spendTnd)}.`
        }
      >
        <Flow
          fmt={whole}
          rows={[
            { label: "Meta says it sold", note: "purchase value reported by Meta, in TND", orders: d.metaPurchases, value: d.metaRevenueTnd, kind: "claim" },
            { label: "Customers ordered", note: "every Shopify order of the period", orders: t.placed.orders, value: t.placed.value, kind: "step" },
            { label: "Fake orders", note: "marked fake by you", orders: t.fake.orders, value: t.fake.value, kind: "minus" },
            { label: "Cancelled, returned, refunded", note: "includes the refunded part of partial refunds", orders: t.reversed.orders, value: t.reversed.value, kind: "minus" },
            { label: "Real revenue", note: "everything still standing", orders: t.real.orders, value: t.real.value, kind: "result" },
            { label: "Delivered", orders: t.delivered.orders, value: t.delivered.value, kind: "part" },
            { label: "On the way", note: "placed or in transit, can still turn into returns", orders: t.open.orders, value: t.open.value, kind: "part" },
          ]}
        />
      </Section>

      <Section title="Meta purchases against real orders, by day">
        {d.days.length < 2 ? (
          <Empty>Pick a longer period to see the trend.</Empty>
        ) : (
          <>
            <Trend days={d.days.map((x) => ({ date: x.date, claim: x.metaPurchases, proof: x.totals.real.orders }))} />
            <div className="vp-legend" style={{ marginTop: 10 }}>
              <span><i className="claim" />Meta purchases</span>
              <span><i className="proof" />Real orders (not cancelled, returned or fake)</span>
            </div>
          </>
        )}
      </Section>

      <Section title="Day by day (TND)">
        <TableWrap>
          <table style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Day placed</th>
                <th style={{ textAlign: "right" }}>Meta purchases</th>
                <th style={{ textAlign: "right" }}>Meta revenue</th>
                <th style={{ textAlign: "right" }}>Orders</th>
                <th style={{ textAlign: "right" }}>Reversed</th>
                <th style={{ textAlign: "right" }}>Fake</th>
                <th style={{ textAlign: "right" }}>Real revenue</th>
                <th style={{ textAlign: "right" }}>Delivered</th>
              </tr>
            </thead>
            <tbody>
              {[...d.days].reverse().map((x) => (
                <tr key={x.date}>
                  <td>{x.date}</td>
                  <td style={{ textAlign: "right" }} className="vp-dim">{x.metaPurchases}</td>
                  <td style={{ textAlign: "right" }} className="vp-dim">{tnd(x.metaRevenueTnd)}</td>
                  <td style={{ textAlign: "right" }}>{x.totals.placed.orders}</td>
                  <td style={{ textAlign: "right" }}>{x.totals.reversed.orders}</td>
                  <td style={{ textAlign: "right" }}>{x.totals.fake.orders}</td>
                  <td style={{ textAlign: "right" }} className="vp-strong">{tnd(x.totals.real.value)}</td>
                  <td style={{ textAlign: "right" }}>{tnd(x.totals.delivered.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Section>

      <Section
        title={`Reversals posted in this period (${d.reversalsPosted.length})`}
        note={`Latest 15 of ${d.reversalsPosted.length}. Orders cancelled, voided or returned between ${d.fromKey} and ${d.toKey}, whenever they were placed. This is how Shopify's own sales report counts them, so use it to explain a difference with Shopify. Money refunded in the period: ${tnd(d.refundedPosted)}.`}
      >
        {d.reversalsPosted.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <TableWrap>
            <table style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Reversed</th>
                  <th style={{ textAlign: "right" }}>Days later</th>
                  <th style={{ textAlign: "right" }}>Value</th>
                  <th>Campaign</th>
                </tr>
              </thead>
              <tbody>
                {d.reversalsPosted.slice(0, 15).map((r) => (
                  <tr key={r.name}>
                    <td>
                      <span className="vp-strong">{r.name}</span>
                      {r.lifecycle === "RETURNED" ? <span className="vp-sub">returned parcel</span> : null}
                    </td>
                    <td>
                      {r.createdKey}
                      {r.olderThanPeriod ? <span className="vp-sub">before this period</span> : null}
                    </td>
                    <td>{r.reversedKey}</td>
                    <td style={{ textAlign: "right" }}>{r.lagDays}</td>
                    <td style={{ textAlign: "right" }}>{tnd(r.value)}</td>
                    <td>{r.campaign ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section
        title={`Needs your attention (${d.stale.length})`}
        note={`Orders still placed or in transit after ${d.staleDays}+ days. Check with the courier, then mark them paid in Shopify when cash arrives.`}
      >
        {d.stale.length === 0 ? (
          <Empty>None, all orders are moving.</Empty>
        ) : (
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th style={{ textAlign: "right" }}>Age (days)</th>
                  <th style={{ textAlign: "right" }}>Value</th>
                  <th>Campaign</th>
                </tr>
              </thead>
              <tbody>
                {d.stale.slice(0, 10).map((s) => (
                  <tr key={s.name}>
                    <td className="vp-strong">{s.name}</td>
                    <td style={{ textAlign: "right" }}>{s.ageDays}</td>
                    <td style={{ textAlign: "right" }}>{tnd(s.value)}</td>
                    <td>{s.campaign ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>
    </Page>
  );
}
