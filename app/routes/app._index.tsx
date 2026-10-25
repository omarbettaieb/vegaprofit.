import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Home() {
  return (
    <s-page heading="VegaProfit">
      <s-section heading="What this app does">
        <s-paragraph>
          VegaProfit shows what your store really earns. It tracks every order through placed, in transit, delivered,
          cancelled, returned and refunded, adds your product costs, delivery fees, expenses and Meta ad spend, and checks
          Meta's numbers against your real Shopify orders.
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/profit">Profit</s-link> · <s-link href="/app/reconcile">Real revenue</s-link> ·{" "}
          <s-link href="/app/meta">Meta ads</s-link> · <s-link href="/app/decisions">Decisions</s-link> ·{" "}
          <s-link href="/app/calendar">Calendar</s-link>
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/costs">Costs</s-link> · <s-link href="/app/export">Export</s-link> ·{" "}
          <s-link href="/app/health">Health check</s-link> · <s-link href="/app/sync">Orders sync</s-link>
        </s-paragraph>
        <s-paragraph>Start with the Health check when something looks wrong: it tells you what to fix.</s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
