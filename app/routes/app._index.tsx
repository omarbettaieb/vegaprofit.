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
      <s-section heading="Where things stand">
        <s-paragraph>
          Profit and Meta-ads decisions for your store. This version syncs your orders, tracks their real status
          (placed, in transit, delivered, cancelled, returned) and shows your profit day by day from your product costs,
          delivery fees and expenses. Meta spend and the KILL / PAUSE / WATCH / CALENDAR / SCALE decisions arrive in the
          next milestones.
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/profit">Profit</s-link> · <s-link href="/app/costs">Costs</s-link> ·{" "}
          <s-link href="/app/sync">Orders sync</s-link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
