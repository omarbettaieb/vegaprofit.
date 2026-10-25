import { Link } from "react-router";
import type { Check } from "../services/health.server";
import { Kpis, Page, Section } from "../ui/kit.tsx";

export default function HealthView({ base, checks }: { base: string; checks: Check[] }) {
  const warn = checks.filter((c) => c.level === "warn").length;
  const fail = checks.filter((c) => c.level === "fail").length;
  const ok = checks.length - warn - fail;
  return (
    <Page title="Health check" lede={fail + warn === 0 ? "Everything is fine." : `${fail + warn} thing(s) to look at. Each one says what to fix.`}>
      <Kpis
        items={[
          { label: "Working", value: String(ok), tone: "pos" },
          { label: "To check", value: String(warn) },
          { label: "Broken", value: String(fail), tone: fail > 0 ? "neg" : undefined },
        ]}
      />
      <Section>
        {checks.map((c) => (
          <div className="vp-check" key={c.name}>
            <span className={`vp-dot ${c.level}`} role="img" aria-label={c.level === "ok" ? "Working" : c.level === "warn" ? "To check" : "Broken"} />
            <div>
              <div className="vp-strong">{c.name}</div>
              <div style={{ color: "var(--ink2)" }}>{c.detail}</div>
              {c.fix ? <div className="vp-fix">{c.fix}</div> : null}
            </div>
          </div>
        ))}
      </Section>
      <p className="vp-note">
        Related pages: <Link to={`${base}/meta`}>Meta ads</Link>
        {base === "/app" ? (
          <>
            , <Link to={`${base}/costs`}>Costs</Link>, <Link to={`${base}/sync`}>Orders sync</Link>
          </>
        ) : null}
        .
      </p>
    </Page>
  );
}
