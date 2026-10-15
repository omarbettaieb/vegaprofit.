import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { orderGidFromWebhook } from "../lib/webhookPayload.ts";
import { syncOrderByGid } from "../services/orderSync.server";

// One endpoint for: orders/create, orders/updated, orders/cancelled, orders/edited, refunds/create.
// authenticate.webhook verifies the HMAC signature and rejects forged requests.
// The handler is idempotent: it re-fetches the order and upserts it, so duplicates and
// out-of-order deliveries converge on Shopify's current state.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  // No admin context means the app was uninstalled: nothing to sync.
  if (!admin) return new Response();

  const gid = orderGidFromWebhook(topic, payload);
  if (!gid) {
    console.warn(`[webhook] ${topic} for ${shop}: no order id in payload`);
    return new Response();
  }

  try {
    await syncOrderByGid(admin, shop, gid, "webhook");
  } catch (e) {
    console.error(`[webhook] ${topic} ${gid} failed`, e);
    // Non-2xx makes Shopify retry the delivery.
    return new Response("sync failed", { status: 500 });
  }
  return new Response();
};
