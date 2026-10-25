import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { dayKey } from "../lib/profit.ts";
import { demoDailyChecks, demoMetaLines, demoPeriod } from "../lib/demoData";
import MetaView from "../views/MetaView";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const today = dayKey(new Date());
  const lv = url.searchParams.get("level");
  const level = lv === "adset" || lv === "ad" ? lv : "campaign";
  const { fromKey, toKey, range } = demoPeriod(url.searchParams.get("range") ?? "30", today, url.searchParams.get("from"), url.searchParams.get("to"));
  const data = demoMetaLines(level, fromKey, toKey);
  const { checks, duplicateStart } = demoDailyChecks(toKey);
  const status = { configured: true, lastSyncAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), error: null };
  return { ...data, status, checks, level, range, fromKey, toKey, duplicateStart };
};

export default function DemoMeta() {
  const data = useLoaderData<typeof loader>();
  return <MetaView base="/demo" {...data} readOnly />;
}
