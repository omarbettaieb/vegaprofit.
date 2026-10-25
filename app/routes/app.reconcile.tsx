import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getReconciliation } from "../services/reconcile.server";
import { dayKey, firstOfMonth, shiftDay } from "../lib/profit.ts";
import ReconcileView from "../views/ReconcileView";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const today = dayKey(new Date());
  const range = url.searchParams.get("range") ?? "30";
  let fromKey = shiftDay(today, -29);
  let toKey = today;
  if (range === "7") fromKey = shiftDay(today, -6);
  else if (range === "60") fromKey = shiftDay(today, -59);
  else if (range === "month") fromKey = firstOfMonth(today);
  else if (range === "custom") {
    const f = url.searchParams.get("from") ?? "";
    const t = url.searchParams.get("to") ?? "";
    if (DATE_RE.test(f) && DATE_RE.test(t) && f <= t) {
      fromKey = f;
      toKey = t;
    }
  }
  const data = await getReconciliation(session.shop, fromKey, toKey);
  return { ...data, range, fromKey, toKey };
};

export default function ReconcilePage() {
  const d = useLoaderData<typeof loader>();
  return <ReconcileView base="/app" {...d} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
