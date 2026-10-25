import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { dayKey } from "../lib/profit.ts";
import { demoPeriod, demoProfit } from "../lib/demoData";
import ProfitView from "../views/ProfitView";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const today = dayKey(new Date());
  const view = url.searchParams.get("view") === "net" ? "net" : "gross";
  const { fromKey, toKey, range } = demoPeriod(url.searchParams.get("range") ?? "30", today, url.searchParams.get("from"), url.searchParams.get("to"));
  return { ...demoProfit(fromKey, toKey, view), view, range };
};

export default function DemoProfit() {
  const data = useLoaderData<typeof loader>();
  return <ProfitView base="/demo" {...data} />;
}
