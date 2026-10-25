import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSyncStatus, setExcluded, startSync } from "../services/orderSync.server";
import { getOverview } from "../services/syncOverview.server";
import type { ReviewRow } from "../services/syncOverview.server";
import { Page, Section } from "../ui/kit.tsx";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [status, overview] = await Promise.all([getSyncStatus(session.shop), getOverview(session.shop)]);
  return { status, overview };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "import" || intent === "recheck") {
    const started = startSync(admin, session.shop, intent === "import" ? "full" : "recheck", "manual");
    return { ok: started, message: started ? "Sync started" : "A sync is already running" };
  }
  if (intent === "exclude" || intent === "restore") {
    const orderId = String(form.get("orderId") ?? "");
    if (orderId) await setExcluded(session.shop, orderId, intent === "exclude", "fake");
    return { ok: true, message: intent === "exclude" ? "Order excluded" : "Order restored" };
  }
  return { ok: false, message: "Unknown action" };
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR") : "never");

const LABELS: Record<string, string> = {
  PLACED: "Placed",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered (paid)",
  CANCELLED: "Cancelled",
  RETURNED: "Returned / refused",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
};

const cell = { textAlign: "left" as const };

function ReviewTable({
  rows,
  actionLabel,
  intent,
  onAct,
}: {
  rows: ReviewRow[];
  actionLabel: string;
  intent: "exclude" | "restore";
  onAct: (intent: string, orderId: string) => void;
}) {
  if (rows.length === 0) return <p className="vp-p">Nothing to review.</p>;
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr>
          <th style={cell}>Order</th>
          <th style={cell}>Date</th>
          <th style={cell}>Total</th>
          <th style={cell}>Status</th>
          <th style={cell}>Why</th>
          <th style={cell} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td style={cell}>{r.name}</td>
            <td style={cell}>{fmt(r.createdAt)}</td>
            <td style={cell}>
              {r.total} {r.currency}
            </td>
            <td style={cell}>{LABELS[r.lifecycle] ?? r.lifecycle}</td>
            <td style={cell}>{r.note}</td>
            <td style={cell}>
              <button type="button" onClick={() => onAct(intent, r.id)}>{actionLabel}</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SyncPage() {
  const { status, overview } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const running = status.state === "running";

  // Poll while a sync is running so progress updates on screen.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(t);
  }, [running, revalidator]);

  const act = (intent: string, orderId?: string) =>
    fetcher.submit(orderId ? { intent, orderId } : { intent }, { method: "post" });

  return (
    <Page title="Orders sync">
      <Section title="Sync with Shopify">
        <p className="vp-p">
          Last status:{" "}
          <strong>
            {running ? "running" : status.state === "error" ? "error" : status.finishedAt ? "done" : "not run yet"}
          </strong>
          {status.mode ? ` (${status.mode === "full" ? "full import" : "re-check"})` : ""}. Started{" "}
          {fmt(status.startedAt)}, finished {fmt(status.finishedAt)}.
        </p>
        <p className="vp-p">
          Orders processed: {status.processed} ({status.created} new, {status.changed} changed status).
        </p>
        {status.error ? <p className="vp-p">Error: {status.error}</p> : null}
        <div className="vp-bar-tools">
          <button type="button" className="vp-primary" disabled={running} onClick={() => act("import")}>
            Import all orders
          </button>
          <button type="button" className="vp-primary" disabled={running} onClick={() => act("recheck")}>
            Re-check last 60 days
          </button>
        </div>
        <p className="vp-p">
          Re-check runs by itself when you open the app and the last check is older than 12 hours, so new orders,
          late cancellations and returns are picked up. You can also click the button above at any time.
        </p>
      </Section>

      <Section title="Orders by status">
        <table style={{ borderCollapse: "collapse" }}>
          <tbody>
            {overview.byLifecycle.map((r) => (
              <tr key={r.lifecycle}>
                <td style={cell}>{LABELS[r.lifecycle] ?? r.lifecycle}</td>
                <td style={cell}>{r.count}</td>
              </tr>
            ))}
            {overview.byLifecycle.length === 0 ? (
              <tr>
                <td style={cell}>No orders yet. Click “Import all orders”.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="vp-p">Excluded orders are not counted here. Median order total (90 days): {overview.medianTicket}.</p>
      </Section>

      <Section title="Alerts">
        <p className="vp-p">
          {overview.staleCount} order(s) shipped more than {overview.staleDays} days ago and still not marked paid: update
          them in Shopify so revenue is correct.
        </p>
        <p className="vp-p">
          {overview.unattributed.none} of {overview.unattributed.total} orders in the last 30 days have no Meta ad
          attached (direct, organic, or missing UTMs).
        </p>
      </Section>

      <Section title="Review: suggested fake orders">
        <p className="vp-p">Suggestions only. Nothing is excluded unless you click.</p>
        <ReviewTable rows={overview.fakeSuggestions} actionLabel="Exclude as fake" intent="exclude" onAct={act} />
      </Section>

      <Section title="Review: possible duplicate orders">
        <p className="vp-p">Same phone number ordering again within a short window. Flag only, never removed.</p>
        <ReviewTable rows={overview.duplicates} actionLabel="Exclude as fake" intent="exclude" onAct={act} />
      </Section>

      <Section title="Excluded orders">
        <ReviewTable rows={overview.excluded} actionLabel="Restore" intent="restore" onAct={act} />
      </Section>
    </Page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
