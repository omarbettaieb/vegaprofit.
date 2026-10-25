import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { dayKey } from "../lib/profit.ts";
import { demoPeriod, demoReconcile } from "../lib/demoData";
import ReconcileView from "../views/ReconcileView";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const today = dayKey(new Date());
  const { fromKey, toKey, range } = demoPeriod(url.searchParams.get("range") ?? "30", today, url.searchParams.get("from"), url.searchParams.get("to"));
  return { ...demoReconcile(fromKey, toKey), range, fromKey, toKey };
};

export default function DemoReconcile() {
  const d = useLoaderData<typeof loader>();
  return <ReconcileView base="/demo" {...d} />;
}
