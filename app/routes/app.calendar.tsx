import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { addCalendarEvent, deleteCalendarEvent, entityChoices, listCalendar, seedCalendarOnce, setCalendarDone } from "../services/decisions.server";
import { dayKey, shiftDay } from "../lib/profit.ts";
import { Page, Section } from "../ui/kit.tsx";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: Record<string, string> = {
  review: "Review date",
  campaign_end: "Campaign end date",
  seasonal_window: "Seasonal window (until)",
  auto_review: "Automatic review",
};

function monthBounds(ym: string): { first: string; last: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${ym}-01`, last: `${ym}-${String(last).padStart(2, "0")}` };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await seedCalendarOnce(session.shop);
  const url = new URL(request.url);
  const today = dayKey(new Date());
  const view = ["day", "month", "range"].includes(url.searchParams.get("view") ?? "") ? url.searchParams.get("view")! : "day";
  const ym = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") ?? "") ? url.searchParams.get("month")! : today.slice(0, 7);

  let from = today;
  let to = shiftDay(today, 13);
  if (view === "month") ({ first: from, last: to } = monthBounds(ym));
  if (view === "range") {
    const f = url.searchParams.get("from") ?? "";
    const t = url.searchParams.get("to") ?? "";
    if (DATE_RE.test(f) && DATE_RE.test(t) && f <= t) {
      from = f;
      to = t;
    }
  }
  const [items, choices] = await Promise.all([listCalendar(session.shop, from, to), entityChoices(session.shop)]);
  return { items, choices, view, ym, from, to, today };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const shop = session.shop;

  if (intent === "addEvent") {
    const date = String(form.get("date") ?? "");
    const kind = String(form.get("kind") ?? "review");
    const title = String(form.get("title") ?? "").trim();
    const from = String(form.get("from") ?? "");
    if (!DATE_RE.test(date) || !title || !["review", "campaign_end", "seasonal_window"].includes(kind)) {
      return { ok: false, message: "An event needs a date, a type and a title" };
    }
    if (kind === "seasonal_window" && !DATE_RE.test(from)) return { ok: false, message: "A seasonal window needs a start date" };
    // entity = "LEVEL:metaId" from the calendar form, or separate fields from the Decisions page
    const picked = String(form.get("entity") ?? "");
    const [lv, id] = picked.includes(":") ? picked.split(":") : [String(form.get("level") ?? ""), String(form.get("entityMetaId") ?? "")];
    const note = kind === "seasonal_window" ? `from:${from} ${String(form.get("note") ?? "")}`.trim() : String(form.get("note") ?? "");
    await addCalendarEvent(shop, { date, kind, title, note, level: lv || null, entityMetaId: id || null });
    return { ok: true, message: "Added to the calendar" };
  }
  if (intent === "done") {
    await setCalendarDone(shop, String(form.get("id") ?? ""), form.get("done") === "1");
    return { ok: true, message: "Updated" };
  }
  if (intent === "delete") {
    await deleteCalendarEvent(shop, String(form.get("id") ?? ""));
    return { ok: true, message: "Removed" };
  }
  return { ok: false, message: "Unknown action" };
};

const cell = { textAlign: "left" as const };
const input = {};
const btn = {};
const KIND_COLOR: Record<string, string> = { review: "#175cd3", campaign_end: "#b42318", seasonal_window: "#7a2eb8", auto_review: "#667085" };

export default function CalendarPage() {
  const { items, choices, view, ym, from, to, today } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const result = fetcher.data as { ok: boolean; message: string } | undefined;

  const byDay = new Map<string, typeof items>();
  for (const it of items) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);

  const EventRow = ({ it }: { it: (typeof items)[number] }) => (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline", opacity: it.done ? 0.5 : 1, textDecoration: it.done ? "line-through" : "none" }}>
      <span style={{ color: KIND_COLOR[it.kind] ?? "#000", fontWeight: 600, fontSize: 12 }}>{KINDS[it.kind] ?? it.kind}</span>
      <span>{it.title}</span>
      {!it.auto ? (
        <>
          <fetcher.Form method="post" style={{ display: "inline" }}>
            <input type="hidden" name="intent" value="done" />
            <input type="hidden" name="id" value={it.id} />
            <input type="hidden" name="done" value={it.done ? "0" : "1"} />
            <button style={btn} type="submit">{it.done ? "Undo" : "Done"}</button>
          </fetcher.Form>
          <fetcher.Form method="post" style={{ display: "inline" }}>
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="id" value={it.id} />
            <button style={btn} type="submit">Remove</button>
          </fetcher.Form>
        </>
      ) : null}
    </div>
  );

  // month grid
  const [y, m] = ym.split("-").map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const prevMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);

  return (
    <Page title="Calendar">
      {result ? (
        <Section>
          <p className="vp-p">
            <strong>{result.ok ? "✓ " : "⚠ "}</strong>
            {result.message}
          </p>
        </Section>
      ) : null}

      <Section title="View">
        <Form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={input} name="view" defaultValue={view}>
            <option value="day">Next 14 days, day by day</option>
            <option value="month">Month</option>
            <option value="range">Custom range</option>
          </select>
          <input style={input} type="month" name="month" defaultValue={ym} />
          <label>From <input style={input} type="date" name="from" defaultValue={from} /></label>
          <label>To <input style={input} type="date" name="to" defaultValue={to} /></label>
          <button style={btn} type="submit">Show</button>
        </Form>
        <p className="vp-p">Showing {from} to {to}. Review dates you set make the Decisions page hold its verdict until that day.</p>
      </Section>

      {view === "month" ? (
        <Section title={ym}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <a href={`?view=month&month=${prevMonth}`}>← {prevMonth}</a>
            <a href={`?view=month&month=${nextMonth}`}>{nextMonth} →</a>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 700, tableLayout: "fixed" }}>
              <thead>
                <tr>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <th key={d} style={cell}>{d}</th>)}</tr>
              </thead>
              <tbody>
                {Array.from({ length: cells.length / 7 }, (_, w) => (
                  <tr key={w}>
                    {cells.slice(w * 7, w * 7 + 7).map((d, i) => (
                      <td key={i} style={{ ...cell, height: 80, border: "1px solid var(--line2)", padding: 6, background: d === today ? "var(--teal-soft)" : undefined }}>
                        {d ? (
                          <>
                            <div style={{ fontWeight: 600 }}>{Number(d.slice(8))}</div>
                            {(byDay.get(d) ?? []).map((it) => (
                              <div key={it.id} style={{ fontSize: 11, color: KIND_COLOR[it.kind], textDecoration: it.done ? "line-through" : "none" }}>{it.title}</div>
                            ))}
                          </>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : (
        <Section title="Day by day">
          {items.length === 0 ? <p className="vp-p">Nothing planned in this period.</p> : null}
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {[...byDay.entries()].map(([d, list]) => (
                <tr key={d}>
                  <td style={{ ...cell, width: 110, fontWeight: d === today ? 700 : 400 }}>{d}{d === today ? " (today)" : ""}</td>
                  <td style={cell}>{list.map((it) => <EventRow key={it.id} it={it} />)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Add a date">
        <fetcher.Form method="post" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="hidden" name="intent" value="addEvent" />
          <select style={input} name="kind" defaultValue="review">
            <option value="review">Review date</option>
            <option value="campaign_end">Campaign end date</option>
            <option value="seasonal_window">Seasonal window</option>
          </select>
          <select style={{ ...input, maxWidth: 320 }} name="entity" defaultValue="">
            <option value="">Whole account</option>
            {choices.map((c) => (
              <option key={`${c.level}:${c.metaId}`} value={`${c.level}:${c.metaId}`}>{c.name}</option>
            ))}
          </select>
          <input style={{ ...input, width: 220 }} name="title" placeholder="Title, e.g. Review Pack Hair" required />
          <label>Date <input style={input} type="date" name="date" required /></label>
          <label>Window starts (seasonal only) <input style={input} type="date" name="from" /></label>
          <input style={{ ...input, width: 200 }} name="note" placeholder="Note (optional)" />
          <button style={btn} type="submit">Add</button>
        </fetcher.Form>
        <p className="vp-p">
          For a seasonal window, "Date" is the last day and "Window starts" the first. While a window is active, entities it
          covers show CALENDAR instead of a decision.
        </p>
      </Section>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
