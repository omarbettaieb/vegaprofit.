import type { ReactNode } from "react";
import { Form, Link, useLocation } from "react-router";
import { CSS } from "./theme.ts";

// ---------- icons ----------

const ICONS: Record<string, string> = {
  home: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  profit: "M3 17l6-6 4 4 8-9M15 6h6v6",
  meta: "M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01",
  revenue: "M4 20V10M10 20V4M16 20v-8M22 20H2",
  decisions: "M9 12l2 2 4-4M12 21a9 9 0 100-18 9 9 0 000 18z",
  calendar: "M4 7h16v13H4zM4 11h16M8 3v4M16 3v4",
  costs: "M3 12l9-9h8v8l-9 9zM15.5 8.5h.01",
  export: "M12 4v11M7 11l5 5 5-5M4 20h16",
  health: "M3 12h4l3-8 4 16 3-8h4",
  sync: "M20 11a8 8 0 00-14-4L4 9M4 4v5h5M4 13a8 8 0 0014 4l2-2M20 20v-5h-5",
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.home} />
    </svg>
  );
}

// ---------- shell ----------

export interface NavItem {
  to: string; // path under base, "" is home
  label: string;
  icon: string;
}

export const APP_NAV: NavItem[] = [
  { to: "", label: "Home", icon: "home" },
  { to: "/profit", label: "Profit", icon: "profit" },
  { to: "/meta", label: "Meta ads", icon: "meta" },
  { to: "/reconcile", label: "Real revenue", icon: "revenue" },
  { to: "/decisions", label: "Decisions", icon: "decisions" },
  { to: "/calendar", label: "Calendar", icon: "calendar" },
  { to: "/costs", label: "Costs", icon: "costs" },
  { to: "/export", label: "Export", icon: "export" },
  { to: "/health", label: "Health", icon: "health" },
  { to: "/sync", label: "Orders sync", icon: "sync" },
];

export const DEMO_NAV: NavItem[] = APP_NAV.filter((n) => ["", "/profit", "/meta", "/reconcile", "/decisions", "/health"].includes(n.to));

// standalone = we draw the side navigation ourselves (public demo). Inside Shopify admin the admin draws it.
export function Shell({ base, standalone = false, children }: { base: string; standalone?: boolean; children: ReactNode }) {
  const { pathname } = useLocation();
  const items = standalone ? DEMO_NAV : APP_NAV;
  return (
    <div className="vp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className={standalone ? "vp-app vp-standalone" : "vp-app"}>
        {standalone ? (
          <aside className="vp-side">
            <div className="vp-brand">
              <span className="vp-mark">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 7l8 12 8-12" />
                </svg>
              </span>
              VegaProfit
            </div>
            <nav className="vp-nav" aria-label="Main">
              {items.map((n) => {
                const href = `${base}${n.to}`;
                const active = n.to === "" ? pathname === base || pathname === `${base}/` : pathname.startsWith(href);
                return (
                  <Link key={n.to} to={href} aria-current={active ? "page" : undefined}>
                    <Icon name={n.icon} />
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="vp-demo-tag">
              <b>Live demo, fake data.</b> A fictional Tunisian supplement store. Every number is generated, nothing is connected to a real shop.
            </div>
          </aside>
        ) : null}
        <main className="vp-main">
          <div className="vp-wrap">{children}</div>
        </main>
      </div>
    </div>
  );
}

// ---------- layout ----------

export function Page({ title, lede, actions, children }: { title: string; lede?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <header className="vp-head">
        <div>
          <h1>{title}</h1>
          {lede ? <p className="vp-lede">{lede}</p> : null}
        </div>
        {actions ? <div className="vp-bar-tools">{actions}</div> : null}
      </header>
      {children}
    </>
  );
}

export function Section({ title, note, right, children }: { title?: string; note?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="vp-sec">
      {title || right ? (
        <div className="vp-sec-head">
          {title ? <h2>{title}</h2> : <span />}
          {right}
        </div>
      ) : null}
      {note ? <p className="vp-note">{note}</p> : null}
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "bad" | "good"; children: ReactNode }) {
  return (
    <div className={`vp-notice ${tone}`} role={tone === "bad" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="vp-empty">{children}</div>;
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="vp-tw">{children}</div>;
}

export type Tone = "red" | "amber" | "green" | "blue" | "grey";
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`vp-badge ${tone}`}>{children}</span>;
}

export interface Kpi {
  label: string;
  value: string;
  unit?: string;
  sub?: ReactNode;
  tone?: "pos" | "neg";
}
export function Kpis({ items }: { items: Kpi[] }) {
  return (
    <div className="vp-kpis">
      {items.map((k) => (
        <div className={`vp-kpi ${k.tone ?? ""}`} key={k.label}>
          <div className="vp-kpi-l">{k.label}</div>
          <div className="vp-kpi-v">
            {k.value}
            {k.unit ? <small>{k.unit}</small> : null}
          </div>
          {k.sub ? <div className="vp-kpi-s">{k.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

// ---------- period controls (links, so the URL is the state) ----------

export function Seg({ name, current, options, label }: { name: string; current: string; options: [string, string][]; label: string }) {
  const { pathname, search } = useLocation();
  return (
    <nav className="vp-seg" aria-label={label}>
      {options.map(([v, l]) => {
        const p = new URLSearchParams(search);
        p.set(name, v);
        if (name === "range" && v !== "custom") {
          p.delete("from");
          p.delete("to");
        }
        return (
          <Link key={v} to={{ pathname, search: `?${p.toString()}` }} aria-current={current === v ? "true" : undefined} preventScrollReset>
            {l}
          </Link>
        );
      })}
    </nav>
  );
}

export function DatePop({ from, to, keep }: { from: string; to: string; keep: Record<string, string> }) {
  return (
    <details className="vp-details">
      <summary>Custom dates</summary>
      <Form method="get" className="vp-pop">
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="range" value="custom" />
        <label>
          From <input type="date" name="from" defaultValue={from} />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={to} />
        </label>
        <button type="submit" className="vp-primary">
          Show
        </button>
      </Form>
    </details>
  );
}

// ---------- charts (plain SVG, no dependencies) ----------

const compact = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1000 ? `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : String(Math.round(a));
  return n < 0 ? `-${s}` : s;
};

// Claimed (hatched) vs proven (solid), one pair of bars per row.
export interface CpRow {
  key: string;
  label: string;
  sub?: string;
  claimed: number;
  proven: number;
}
export function ClaimProof({ rows, unit = "" }: { rows: CpRow[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.claimed, r.proven)));
  const w = (n: number) => `${Math.max(0, (n / max) * 100)}%`;
  return (
    <div>
      <div className="vp-legend">
        <span>
          <i className="claim" />
          What Meta says it sold
        </span>
        <span>
          <i className="proof" />
          What Shopify can prove
        </span>
      </div>
      <div className="vp-cp" role="list">
        {rows.map((r, i) => (
          <div className="vp-cp-row" role="listitem" key={r.key}>
            <div className="vp-cp-name" title={r.label}>
              {r.label}
              {r.sub ? <span>{r.sub}</span> : null}
            </div>
            <div className="vp-cp-bars">
              <div className="vp-bar">
                <div className="vp-bar-fill claim" style={{ width: w(r.claimed), ["--d" as string]: `${i * 70}ms` }} />
                <span className="vp-bar-v claim">
                  {r.claimed}
                  {unit}
                </span>
              </div>
              <div className="vp-bar">
                <div className="vp-bar-fill proof" style={{ width: w(r.proven), ["--d" as string]: `${i * 70 + 160}ms` }} />
                <span className="vp-bar-v">
                  {r.proven}
                  {unit}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Daily bars around a zero line: teal above, red below.
export function DailyBars({ days, height = 220 }: { days: { date: string; value: number }[]; height?: number }) {
  const W = 720;
  const padL = 44;
  const padB = 22;
  const H = height;
  const plotH = H - padB - 8;
  const vals = days.map((d) => d.value);
  const hi = Math.max(0, ...vals);
  const lo = Math.min(0, ...vals);
  const span = hi - lo || 1;
  const y = (v: number) => 8 + ((hi - v) / span) * plotH;
  const step = (W - padL) / Math.max(1, days.length);
  const bw = Math.max(2, Math.min(18, step * 0.66));
  const ticks = [hi, 0, lo].filter((v, i, a) => a.indexOf(v) === i);
  const labelAt = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => days.length > 0 && a.indexOf(v) === i);
  return (
    <svg className="vp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profit after ads, day by day">
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={padL} x2={W} y1={y(t)} y2={y(t)} />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end">
            {compact(t)}
          </text>
        </g>
      ))}
      <line className="zero" x1={padL} x2={W} y1={y(0)} y2={y(0)} />
      {days.map((d, i) => {
        const x = padL + i * step + (step - bw) / 2;
        const top = Math.min(y(d.value), y(0));
        const h = Math.max(1.5, Math.abs(y(d.value) - y(0)));
        return (
          <rect key={d.date} className={d.value >= 0 ? "pos" : "neg"} x={x} y={top} width={bw} height={h} rx={2}>
            <title>{`${d.date}: ${Math.round(d.value)} TND`}</title>
          </rect>
        );
      })}
      {labelAt.map((i) => (
        <text key={i} x={padL + i * step + step / 2} y={H - 4} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}>
          {days[i].date.slice(5)}
        </text>
      ))}
    </svg>
  );
}

// Two lines per day: what Meta claims (dashed) and what Shopify shows (solid), shaded where they disagree.
export function Trend({ days, height = 200 }: { days: { date: string; claim: number; proof: number }[]; height?: number }) {
  const W = 720;
  const padL = 34;
  const padB = 22;
  const H = height;
  const plotH = H - padB - 10;
  const max = Math.max(1, ...days.map((d) => Math.max(d.claim, d.proof)));
  const n = Math.max(1, days.length - 1);
  const x = (i: number) => padL + (i / n) * (W - padL - 6);
  const y = (v: number) => 10 + (1 - v / max) * plotH;
  const pts = (f: (d: (typeof days)[number]) => number) => days.map((d, i) => `${x(i).toFixed(1)},${y(f(d)).toFixed(1)}`);
  const claim = pts((d) => d.claim);
  const proof = pts((d) => d.proof);
  const area = `M${claim.join(" L")} L${[...proof].reverse().join(" L")} Z`;
  const ticks = [max, max / 2, 0];
  const labelAt = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => days.length > 0 && a.indexOf(v) === i);
  return (
    <svg className="vp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Meta purchases against Shopify orders, day by day">
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={padL} x2={W} y1={y(t)} y2={y(t)} />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end">
            {Math.round(t)}
          </text>
        </g>
      ))}
      {days.length > 1 ? <path d={area} fill="#9AA8A4" opacity="0.22" /> : null}
      <polyline fill="none" stroke="#7D8D88" strokeWidth="1.8" strokeDasharray="5 4" points={claim.join(" ")} />
      <polyline fill="none" stroke="#0E7C86" strokeWidth="2.4" strokeLinejoin="round" points={proof.join(" ")} />
      {labelAt.map((i) => (
        <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}>
          {days[i].date.slice(5)}
        </text>
      ))}
    </svg>
  );
}

// Money flow rows (used by Real revenue): a bar per step, plain or subtracted.
export interface FlowRow {
  label: string;
  note?: string;
  orders?: number | string;
  value: number;
  kind: "claim" | "step" | "minus" | "result" | "part";
}
export function Flow({ rows, fmt }: { rows: FlowRow[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="vp-cp">
      {rows.map((r, i) => (
        <div className="vp-cp-row" key={r.label}>
          <div className="vp-cp-name" style={{ fontWeight: r.kind === "result" ? 700 : 560, paddingLeft: r.kind === "part" ? 14 : 0 }}>
            {r.label}
            {r.note ? <span>{r.note}</span> : null}
          </div>
          <div className="vp-bar">
            <div
              className={`vp-bar-fill ${r.kind === "claim" ? "claim" : "proof"}`}
              style={{
                width: `${(Math.abs(r.value) / max) * 100}%`,
                ["--d" as string]: `${i * 80}ms`,
                background: r.kind === "minus" ? "#C9776E" : r.kind === "part" ? "#6FB3B9" : undefined,
                opacity: r.kind === "step" ? 0.55 : 1,
              }}
            />
            <span className={`vp-bar-v ${r.kind === "claim" ? "claim" : ""}`}>
              {r.kind === "minus" ? "-" : ""}
              {fmt(Math.abs(r.value))}
              {r.orders !== undefined ? <span style={{ color: "var(--faint)", fontWeight: 400 }}> · {r.orders} orders</span> : null}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
