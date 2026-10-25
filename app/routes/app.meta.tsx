import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { DUPLICATE_START, getDailyChecks, getMetaLines, getMetaStatus, syncMeta } from "../services/meta.server";
import type { MetaLevelName } from "../services/meta.server";
import { dayKey, firstOfMonth, shiftDay } from "../lib/profit.ts";
import MetaView from "../views/MetaView";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const today = dayKey(new Date());
  const lv = url.searchParams.get("level");
  const level: MetaLevelName = lv === "adset" || lv === "ad" ? lv : "campaign";
  const range = url.searchParams.get("range") ?? "7";

  let fromKey = shiftDay(today, -6);
  if (range === "today") fromKey = today;
  else if (range === "30") fromKey = shiftDay(today, -29);
  else if (range === "month") fromKey = firstOfMonth(today);
  let toKey = today;
  if (range === "custom") {
    const f = url.searchParams.get("from") ?? "";
    const t = url.searchParams.get("to") ?? "";
    if (DATE_RE.test(f) && DATE_RE.test(t) && f <= t) {
      fromKey = f;
      toKey = t;
    }
  }

  const [data, status, checks] = await Promise.all([
    getMetaLines(session.shop, level, fromKey, toKey),
    getMetaStatus(session.shop),
    getDailyChecks(session.shop, toKey),
  ]);
  return { ...data, status, checks, level, range, fromKey, toKey, duplicateStart: DUPLICATE_START };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  try {
    const r = await syncMeta(session.shop);
    return { ok: true, message: `Meta synced: ${r.rows} ad-day rows for the last 60 days.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Sync failed" };
  }
};

export default function MetaPage() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return <MetaView base="/app" {...data} notice={result ?? null} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
