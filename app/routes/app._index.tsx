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
          Profit and Meta-ads decisions for your store. This version syncs your orders and tracks their real status
          (placed, in transit, delivered, cancelled, returned). Profit, Meta spend and the KILL / PAUSE / WATCH / CALENDAR
          / SCALE decisions arrive in the next milestones.
        </s-paragraph>
        <s-paragraph>
          <s-link href="/app/sync">Open the orders sync page</s-link>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
