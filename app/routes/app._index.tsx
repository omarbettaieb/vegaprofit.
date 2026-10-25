import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getDecisions } from "../services/decisions.server";
import { getDailyChecks, getMetaLines, getMetaStatus } from "../services/meta.server";
import { getProfitReport } from "../services/profit.server";
import { dayKey, shiftDay } from "../lib/profit.ts";
import HomeView from "../views/HomeView";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const today = dayKey(new Date());
  const from = shiftDay(today, -29);
  const [meta, decisions, profit, status, checks] = await Promise.all([
    getMetaLines(session.shop, "campaign", from, today),
    getDecisions(session.shop, "campaign"),
    getProfitReport(session.shop, from, today, "gross"),
    getMetaStatus(session.shop),
    getDailyChecks(session.shop, today),
  ]);
  return { lines: meta.lines, decisions: decisions.lines, report: profit.report, periodDays: 30, metaConfigured: status.configured, checks };
};

export default function Home() {
  const data = useLoaderData<typeof loader>();
  return <HomeView base="/app" {...data} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
