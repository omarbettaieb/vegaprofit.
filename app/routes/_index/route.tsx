import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// Shopify opens the app at "/?shop=...": send it to the embedded app. Anyone else lands on the public demo.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  throw redirect("/demo");
};

export default function Index() {
  return null;
}
