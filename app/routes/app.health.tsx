import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { runHealth } from "../services/health.server";
import HealthView from "../views/HealthView";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const checks = await runHealth(admin, session.shop);
  return { checks };
};

export default function HealthPage() {
  const { checks } = useLoaderData<typeof loader>();
  return <HealthView base="/app" checks={checks} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
