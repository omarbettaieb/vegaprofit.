import { Link } from "react-router";
import type { Report } from "../lib/profit.ts";
import { DailyBars, DatePop, Flow, Kpis, Notice, Page, Section, Seg, TableWrap } from "../ui/kit.tsx";
import { tnd, whole } from "../ui/format.ts";

export interface ProfitProps {
  base: string;
  report: Report;
  feeOut: number;
  fxUsdTnd: number;
  fromKey: string;
  toKey: string;
  view: "gross" | "net";
  range: string;
}

export default function ProfitView({ base, report, feeOut, fxUsdTnd, fromKey, toKey, view, range }: ProfitProps) {
  const t = report.totals;
  const rows = [...report.days].reverse();
  return (
    <Page
      title="Profit"
      lede={`${fromKey} to ${toKey}, ${view === "gross" ? "everything that is not cancelled or returned" : "delivered orders only"}. Days follow Tunisia time.`}
      actions={
        <>
          <Seg name="range" label="Period" current={range} options={[["7", "7 days"], ["30", "30 days"], ["60", "60 days"], ["month", "This month"]]} />
          <DatePop from={fromKey} to={toKey} keep={{ view }} />
          <Seg name="view" label="View" current={view} options={[["gross", "Gross"], ["net", "Net"]]} />
        </>
      }
    >
      {feeOut === 0 ? (
        <Notice tone="warn">
          The delivery fee is 0, so profit is overstated. <Link to={`${base}/costs`}>Set it on the Costs page</Link>.
        </Notice>
      ) : null}
      {fxUsdTnd === 0 ? (
        <Notice tone="warn">
          No USD to TND rate is set, so ad spend counts as 0. <Link to={`${base}/costs`}>Set the rate on the Costs page</Link>.
        </Notice>
      ) : null}
      {report.ordersMissingCost > 0 ? (
        <Notice tone="warn">
          {report.ordersMissingCost} order(s) contain products with no cost, so their profit is overstated. <Link to={`${base}/costs`}>Enter the product costs</Link>.
        </Notice>
      ) : null}

      <Kpis
        items={[
          { label: "Revenue", value: whole(t.revenue), unit: "TND", sub: `${t.orders} orders` },
          { label: "Profit before ads", value: whole(t.profit), unit: "TND", sub: t.marginPct === null ? undefined : `${t.marginPct.toFixed(1)}% margin` },
          { label: "Ad spend", value: whole(t.adSpend), unit: "TND", sub: "Meta, converted" },
          { label: "Profit after ads", value: whole(t.profitAfterAds), unit: "TND", tone: t.profitAfterAds >= 0 ? "pos" : "neg", sub: t.avgOrderValue === null ? undefined : `${tnd(t.avgOrderValue)} average order` },
        ]}
      />

      <div className="vp-cols">
        <Section title="Day by day, after ads">
          <DailyBars days={report.days.map((d) => ({ date: d.date, value: d.profitAfterAds }))} />
        </Section>
        <Section title="Where the revenue went" note={t.returnedParcels > 0 ? `${t.returnedParcels} returned parcel(s) cost ${tnd(t.returnsLoss)} TND in delivery.` : undefined}>
          <Flow
            fmt={whole}
            rows={[
              { label: "Revenue", value: t.revenue, kind: "result" },
              { label: "Product cost", value: t.cogs, kind: "minus" },
              { label: "Delivery", value: t.delivery, kind: "minus" },
              { label: "Other expenses", value: t.expenses, kind: "minus" },
              { label: "Ad spend", value: t.adSpend, kind: "minus" },
              { label: "Profit after ads", value: Math.abs(t.profitAfterAds), kind: t.profitAfterAds >= 0 ? "result" : "minus" },
            ]}
          />
        </Section>
      </div>

      <Section title="Day by day (TND)">
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th style={{ textAlign: "right" }}>Orders</th>
                <th style={{ textAlign: "right" }}>Revenue</th>
                <th style={{ textAlign: "right" }}>Product cost</th>
                <th style={{ textAlign: "right" }}>Delivery</th>
                <th style={{ textAlign: "right" }}>Expenses</th>
                <th style={{ textAlign: "right" }}>Before ads</th>
                <th style={{ textAlign: "right" }}>Ad spend</th>
                <th style={{ textAlign: "right" }}>After ads</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.date}>
                  <td>{d.date}</td>
                  <td style={{ textAlign: "right" }}>{d.orders}</td>
                  <td style={{ textAlign: "right" }}>{tnd(d.revenue)}</td>
                  <td style={{ textAlign: "right" }}>{tnd(d.cogs)}</td>
                  <td style={{ textAlign: "right" }}>{tnd(d.delivery)}</td>
                  <td style={{ textAlign: "right" }}>{tnd(d.expenses)}</td>
                  <td style={{ textAlign: "right" }}>{tnd(d.profit)}</td>
                  <td style={{ textAlign: "right" }}>{tnd(d.adSpend)}</td>
                  <td style={{ textAlign: "right" }} className={`vp-strong ${d.profitAfterAds < 0 ? "vp-neg" : ""}`}>
                    {tnd(d.profitAfterAds)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td style={{ textAlign: "right" }}>{t.orders}</td>
                <td style={{ textAlign: "right" }}>{tnd(t.revenue)}</td>
                <td style={{ textAlign: "right" }}>{tnd(t.cogs)}</td>
                <td style={{ textAlign: "right" }}>{tnd(t.delivery)}</td>
                <td style={{ textAlign: "right" }}>{tnd(t.expenses)}</td>
                <td style={{ textAlign: "right" }}>{tnd(t.profit)}</td>
                <td style={{ textAlign: "right" }}>{tnd(t.adSpend)}</td>
                <td style={{ textAlign: "right" }}>{tnd(t.profitAfterAds)}</td>
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      </Section>
    </Page>
  );
}
