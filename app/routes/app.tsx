import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { catchUpIfDue } from "../services/orderSync.server";
import { metaSyncIfDue } from "../services/meta.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  // Re-check recent orders in the background when the last check is stale (late cancellations/returns,
  // missed webhooks). Never blocks the page; does nothing until the first full import has run.
  void catchUpIfDue(admin, session.shop).catch((e) => console.error("[catch-up] failed", e));

  void metaSyncIfDue(session.shop).catch((e) => console.error("[meta-sync] failed", e));

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/profit">Profit</s-link>
        <s-link href="/app/meta">Meta ads</s-link>
        <s-link href="/app/costs">Costs</s-link>
        <s-link href="/app/sync">Orders sync</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
