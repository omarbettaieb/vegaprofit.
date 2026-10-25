import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getDecisions, saveRules } from "../services/decisions.server";
import type { MetaLevelName } from "../services/meta.server";
import { parseAmount } from "../lib/money.ts";
import DecisionsView, { FIELDS } from "../views/DecisionsView";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const lv = new URL(request.url).searchParams.get("level");
  const level: MetaLevelName = lv === "adset" || lv === "ad" ? lv : "campaign";
  const data = await getDecisions(session.shop, level);
  return { ...data, level };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const values: Record<string, number> = {};
  for (const [key] of FIELDS) {
    const n = parseAmount(form.get(key));
    if (n === null || n < 0) return { ok: false, message: `"${key}" must be a number` };
    values[key] = n;
  }
  await saveRules(session.shop, values);
  return { ok: true, message: "Thresholds saved" };
};

export default function DecisionsPage() {
  const data = useLoaderData<typeof loader>();
  const saved = useActionData<typeof action>();
  return <DecisionsView base="/app" {...data} notice={saved ?? null} />;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
