import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getSyncStatus, setExcluded, startSync } from "../services/orderSync.server";
import { getOverview } from "../services/syncOverview.server";
import type { ReviewRow } from "../services/syncOverview.server";

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

const cell = { padding: "6px 10px", textAlign: "left" as const, borderBottom: "1px solid #e1e3e5" };

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
  if (rows.length === 0) return <s-paragraph>Nothing to review.</s-paragraph>;
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
              <s-button onClick={() => onAct(intent, r.id)}>{actionLabel}</s-button>
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
    <s-page heading="Orders sync">
      <s-section heading="Sync with Shopify">
        <s-paragraph>
          Last status:{" "}
          <strong>
            {running ? "running" : status.state === "error" ? "error" : status.finishedAt ? "done" : "not run yet"}
          </strong>
          {status.mode ? ` (${status.mode === "full" ? "full import" : "re-check"})` : ""}. Started{" "}
          {fmt(status.startedAt)}, finished {fmt(status.finishedAt)}.
        </s-paragraph>
        <s-paragraph>
          Orders processed: {status.processed} ({status.created} new, {status.changed} changed status).
        </s-paragraph>
        {status.error ? <s-paragraph>Error: {status.error}</s-paragraph> : null}
        <s-stack direction="inline" gap="base">
          <s-button disabled={running} onClick={() => act("import")}>
            Import all orders
          </s-button>
          <s-button disabled={running} onClick={() => act("recheck")}>
            Re-check last 60 days
          </s-button>
        </s-stack>
        <s-paragraph>
          Re-check runs by itself when you open the app and the last check is older than 12 hours, so new orders,
          late cancellations and returns are picked up. You can also click the button above at any time.
        </s-paragraph>
      </s-section>

      <s-section heading="Orders by status">
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
        <s-paragraph>Excluded orders are not counted here. Median order total (90 days): {overview.medianTicket}.</s-paragraph>
      </s-section>

      <s-section heading="Alerts">
        <s-paragraph>
          {overview.staleCount} order(s) shipped more than {overview.staleDays} days ago and still not marked paid: update
          them in Shopify so revenue is correct.
        </s-paragraph>
        <s-paragraph>
          {overview.unattributed.none} of {overview.unattributed.total} orders in the last 30 days have no Meta ad
          attached (direct, organic, or missing UTMs).
        </s-paragraph>
      </s-section>

      <s-section heading="Review: suggested fake orders">
        <s-paragraph>Suggestions only. Nothing is excluded unless you click.</s-paragraph>
        <ReviewTable rows={overview.fakeSuggestions} actionLabel="Exclude as fake" intent="exclude" onAct={act} />
      </s-section>

      <s-section heading="Review: possible duplicate orders">
        <s-paragraph>Same phone number ordering again within a short window. Flag only, never removed.</s-paragraph>
        <ReviewTable rows={overview.duplicates} actionLabel="Exclude as fake" intent="exclude" onAct={act} />
      </s-section>

      <s-section heading="Excluded orders">
        <ReviewTable rows={overview.excluded} actionLabel="Restore" intent="restore" onAct={act} />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
