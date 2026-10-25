import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { demoDecisions } from "../lib/demoData";
import DecisionsView from "../views/DecisionsView";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const lv = new URL(request.url).searchParams.get("level");
  const level = lv === "adset" || lv === "ad" ? lv : "campaign";
  return { ...demoDecisions(level), level };
};

export default function DemoDecisions() {
  const data = useLoaderData<typeof loader>();
  return <DecisionsView base="/demo" {...data} readOnly />;
}
