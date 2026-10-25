import { useLoaderData } from "react-router";
import { demoHealth } from "../lib/demoData";
import HealthView from "../views/HealthView";

export const loader = async () => ({ checks: demoHealth() });

export default function DemoHealth() {
  const { checks } = useLoaderData<typeof loader>();
  return <HealthView base="/demo" checks={checks} />;
}
