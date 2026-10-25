import { useLoaderData } from "react-router";
import { dayKey, shiftDay } from "../lib/profit.ts";
import { demoDailyChecks, demoDecisions, demoMetaLines, demoProfit } from "../lib/demoData";
import HomeView from "../views/HomeView";

export const loader = async () => {
  const today = dayKey(new Date());
  const from = shiftDay(today, -29);
  return {
    lines: demoMetaLines("campaign", from, today).lines,
    decisions: demoDecisions("campaign").lines,
    report: demoProfit(from, today, "gross").report,
    periodDays: 30,
    metaConfigured: true,
    checks: demoDailyChecks(today).checks,
  };
};

export default function DemoHome() {
  const data = useLoaderData<typeof loader>();
  return <HomeView base="/demo" {...data} />;
}
