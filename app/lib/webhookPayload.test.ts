import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeTopic, orderGidFromWebhook } from "./webhookPayload.ts";

describe("orderGidFromWebhook", () => {
  it("orders/* uses admin_graphql_api_id", () => {
    assert.equal(
      orderGidFromWebhook("ORDERS_UPDATED", { id: 1, admin_graphql_api_id: "gid://shopify/Order/18950012076122" }),
      "gid://shopify/Order/18950012076122",
    );
  });
  it("orders/* falls back to the numeric id", () => {
    assert.equal(orderGidFromWebhook("orders/create", { id: 18950012076122 }), "gid://shopify/Order/18950012076122");
  });
  it("refunds/create uses order_id", () => {
    assert.equal(
      orderGidFromWebhook("REFUNDS_CREATE", { id: 5, order_id: 18950012076122 }),
      "gid://shopify/Order/18950012076122",
    );
  });
  it("fulfillments/* uses order_id", () => {
    assert.equal(orderGidFromWebhook("fulfillments/update", { id: 9, order_id: 77 }), "gid://shopify/Order/77");
  });
  it("ignores an admin_graphql_api_id that is not an order", () => {
    assert.equal(
      orderGidFromWebhook("ORDERS_CREATE", { id: 5, admin_graphql_api_id: "gid://shopify/Customer/5" }),
      "gid://shopify/Order/5",
    );
  });
  it("returns null for unrelated topics and bad payloads", () => {
    assert.equal(orderGidFromWebhook("APP_UNINSTALLED", {}), null);
    assert.equal(orderGidFromWebhook("ORDERS_CREATE", null), null);
    assert.equal(orderGidFromWebhook("REFUNDS_CREATE", {}), null);
  });
  it("normalizeTopic accepts both forms", () => {
    assert.equal(normalizeTopic("orders/create"), "ORDERS_CREATE");
    assert.equal(normalizeTopic("ORDERS_CREATE"), "ORDERS_CREATE");
  });
});
