// Webhook payloads use a REST-style shape that differs from the GraphQL order we store, so on
// every webhook we only read the order id from the payload and re-fetch the order through the same
// GraphQL query used by the import. One mapper, one source of truth, and the handler stays idempotent.

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

// Topic comes as "ORDERS_CREATE" (library enum) or "orders/create" (raw header). Accept both.
export function normalizeTopic(topic: string): string {
  return topic.trim().toUpperCase().replace(/[/.]/g, "_");
}

export function orderGidFromWebhook(topic: string, payload: unknown): string | null {
  const p = asRecord(payload);
  const t = normalizeTopic(topic);

  if (t.startsWith("ORDERS_")) {
    if (typeof p.admin_graphql_api_id === "string" && p.admin_graphql_api_id.includes("/Order/")) {
      return p.admin_graphql_api_id;
    }
    if (p.id != null) return `gid://shopify/Order/${String(p.id)}`;
    return null;
  }
  if (t.startsWith("REFUNDS_") || t.startsWith("FULFILLMENTS_")) {
    if (p.order_id != null) return `gid://shopify/Order/${String(p.order_id)}`;
    return null;
  }
  return null;
}
