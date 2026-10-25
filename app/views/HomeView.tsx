import { Link } from "react-router";
import type { Report } from "../lib/profit.ts";
import type { DayCheck } from "../lib/truth.ts";
import type { TruthLine } from "../services/meta.server";
import type { DecisionLine } from "../services/decisions.server";
import { Badge, ClaimProof, DailyBars, Empty, Kpis, Page, Section, Trend } from "../ui/kit.tsx";
import type { Tone } from "../ui/kit.tsx";
import { roas, whole } from "../ui/format.ts";

export interface HomeProps {
  base: string;
  lines: TruthLine[];
  decisions: DecisionLine[];
  report: Report;
  periodDays: number;
  metaConfigured: boolean;
  checks: DayCheck[];
}

export const VERDICT_TONE: Record<string, Tone> = { KILL: "red", PAUSE: "amber", SCALE: "green", CALENDAR: "blue", WATCH: "grey" };
export const VERDICT_LABEL: Record<string, string> = { KILL: "Kill", PAUSE: "Pause", SCALE: "Scale", CALENDAR: "Wait", WATCH: "Watch" };

export default function HomeView({ base, lines, decisions, report, periodDays, metaConfigured, checks }: HomeProps) {
  const t = report.totals;
  const worst = [...lines].filter((l) => l.metaPurchases >= 4).sort((a, b) => b.unexplained - a.unexplained)[0];
  const sumMeta = lines.reduce((a, l) => a + l.metaPurchases, 0);
  const sumTrue = lines.reduce((a, l) => a + l.trueOrders, 0);
  const over = sumTrue > 0 ? ((sumMeta - sumTrue) / sumTrue) * 100 : null;
  const top = [...lines].sort((a, b) => b.spendTnd - a.spendTnd).slice(0, 6);
  const days = report.days.map((d) => ({ date: d.date, value: d.profitAfterAds }));
  const roasReal = t.adSpend > 0 ? t.revenue / t.adSpend : null;

  return (
    <Page title="Overview" lede={`The last ${periodDays} days of your store, with Meta's claims checked against real orders.`}>
      <div className="vp-gap">
        {worst && worst.unexplained >= 3 ? (
          <>
            <h2>
              Meta says <span className="vp-n-claim">{worst.metaPurchases}</span> purchases for {worst.name}. Shopify can prove{" "}
              <span className="vp-n-proof">{worst.trueOrders}</span>.
            </h2>
            <p className="vp-gap-sub">
              {worst.reversedOrders + worst.excludedOrders} of the orders behind it were cancelled, returned or fake, and {worst.unexplained} purchases have no
              order at all.{" "}
              <Link to={`${base}/meta`}>See the full check</Link>
            </p>
          </>
        ) : metaConfigured && lines.length > 0 ? (
          <>
            <h2>
              Meta and Shopify <span className="vp-n-proof">agree</span> on every campaign.
            </h2>
            <p className="vp-gap-sub">No campaign reports far more purchases than Shopify has orders. Keep checking after every tracking change.</p>
          </>
        ) : (
          <>
            <h2>Connect Meta to see what is real.</h2>
            <p className="vp-gap-sub">
              Add the Meta token on Render, then press Sync on the <Link to={`${base}/meta`}>Meta ads</Link> page.
            </p>
          </>
        )}
        {top.length > 0 ? (
          <ClaimProof rows={top.map((l) => ({ key: l.key, label: l.name, claimed: l.metaPurchases, proven: l.trueOrders }))} />
        ) : (
          <Empty>No ad data for this period yet.</Empty>
        )}
      </div>

      <Kpis
        items={[
          { label: "Profit after ads", value: whole(t.profitAfterAds), unit: "TND", tone: t.profitAfterAds >= 0 ? "pos" : "neg", sub: t.marginPct === null ? undefined : `${t.marginPct.toFixed(0)}% margin before ads` },
          { label: "Revenue", value: whole(t.revenue), unit: "TND", sub: `${t.orders} orders counted` },
          { label: "Ad spend", value: whole(t.adSpend), unit: "TND", sub: roasReal === null ? undefined : `${roas(roasReal)} real return on spend` },
          { label: "Meta overstates by", value: over === null ? "-" : `${Math.round(over)}%`, tone: over !== null && over > 25 ? "neg" : undefined, sub: `${sumMeta} claimed, ${sumTrue} proven` },
        ]}
      />

      <div className="vp-cols">
        <div className="vp-stack">
          <Section title="Profit after ads, day by day" right={<Link to={`${base}/profit`}>Open profit</Link>}>
            <DailyBars days={days} />
          </Section>
          {checks.length > 1 ? (
            <Section title="Meta purchases against Shopify orders" right={<Link to={`${base}/meta`}>Open check</Link>} note="Where the dashed line sits above the solid one, Meta reported purchases that no order explains.">
              <Trend days={checks.map((c) => ({ date: c.date, claim: c.metaPurchases, proof: c.shopifyOrders }))} height={170} />
            </Section>
          ) : null}
        </div>
        <Section title="What to do today" right={<Link to={`${base}/decisions`}>All decisions</Link>}>
          {decisions.length === 0 ? (
            <Empty>Nothing to judge yet.</Empty>
          ) : (
            <div className="vp-vlist">
              {decisions.slice(0, 7).map((d) => (
                <div className="vp-vrow" key={d.key}>
                  <Badge tone={VERDICT_TONE[d.result.verdict]}>{VERDICT_LABEL[d.result.verdict]}</Badge>
                  <div>
                    <b>{d.name}</b>
                    <small>{d.result.reason}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </Page>
  );
}
