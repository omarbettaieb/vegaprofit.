import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { Shell } from "../ui/kit";

export const meta: MetaFunction = () => [
  { title: "VegaProfit live demo" },
  { name: "description", content: "Profit analytics and an ad-truth check for cash-on-delivery stores. Demo with fake data." },
];

// Public demo: no Shopify login, no database. Every number comes from app/lib/demoData.ts.
export default function DemoLayout() {
  return (
    <Shell base="/demo" standalone>
      <Outlet />
    </Shell>
  );
}
