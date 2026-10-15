import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gidToId, normalizeOrder } from "./normalize.ts";
import type { ShopifyOrderNode } from "./normalize.ts";
import { hashIdentifier, normalizeEmail, normalizePhone } from "./phone.ts";
import { mergeSettings, SETTING_DEFAULTS } from "./settings.ts";

const SECRET = "test-secret";

function baseOrder(over: Partial<ShopifyOrderNode> = {}): ShopifyOrderNode {
  return {
    id: "gid://shopify/Order/18950012076122",
    name: "#2123",
    createdAt: "2026-10-12T23:14:28Z",
    cancelledAt: null,
    cancelReason: null,
    displayFinancialStatus: "PENDING",
    displayFulfillmentStatus: "UNFULFILLED",
    tags: [],
    customAttributes: [],
    totalPriceSet: { shopMoney: { amount: "840.0", currencyCode: "TND" } },
    customerJourneySummary: {
      ready: true,
      firstVisit: null,
      lastVisit: {
        landingPage: "https://shop.example/products/marine-collagen",
        source: "Facebook",
        utmParameters: {
          source: "facebook",
          medium: "paid",
          campaign: "120248559200620179",
          content: "120248559546940179",
          term: "120248559200590179",
        },
      },
    },
    fulfillments: [],
    lineItems: {
      nodes: [
        {
          id: "gid://shopify/LineItem/111",
          title: "Marine Collagen",
          quantity: 10,
          sku: null,
          variant: { id: "gid://shopify/ProductVariant/222" },
          product: { id: "gid://shopify/Product/333" },
          originalUnitPriceSet: { shopMoney: { amount: "84.0", currencyCode: "TND" } },
          totalDiscountSet: { shopMoney: { amount: "0.0", currencyCode: "TND" } },
        },
      ],
    },
    ...over,
  };
}

describe("normalizeOrder", () => {
  it("maps a placed Meta order end to end", () => {
    const n = normalizeOrder(baseOrder({ phone: "+216 20 000 001" }), SECRET);
    assert.equal(n.shopifyOrderId, "18950012076122");
    assert.equal(n.lifecycle, "PLACED");
    assert.equal(n.currency, "TND");
    assert.equal(n.totalPrice, "840.0");
    assert.equal(n.attribution.method, "ID");
    assert.equal(n.attribution.campaignId, "120248559200620179");
    assert.equal(n.attribution.adId, "120248559546940179");
    assert.equal(n.totalQuantity, 10);
    assert.equal(n.lines[0]!.variantId, "222");
    assert.equal(n.lines[0]!.productId, "333");
    assert.equal(typeof n.phoneHash, "string");
    assert.equal(n.phoneHash!.length, 64);
  });

  it("never exposes the raw phone or email", () => {
    const n = normalizeOrder(baseOrder({ phone: "20000001", email: "a@b.com" }), SECRET);
    const json = JSON.stringify(n);
    assert.equal(json.includes("20000001"), false);
    assert.equal(json.includes("a@b.com"), false);
  });

  it("same phone written differently hashes identically", () => {
    const a = normalizeOrder(baseOrder({ phone: "20 000 001" }), SECRET);
    const b = normalizeOrder(baseOrder({ phone: "+21620000001" }), SECRET);
    const c = normalizeOrder(baseOrder({ phone: "0021620000001" }), SECRET);
    assert.equal(a.phoneHash, b.phoneHash);
    assert.equal(a.phoneHash, c.phoneHash);
  });

  it("falls back to shipping address phone, then the COD-form note attribute", () => {
    const ship = normalizeOrder(baseOrder({ shippingAddress: { phone: "20000001" } }), SECRET);
    const note = normalizeOrder(
      baseOrder({ customAttributes: [{ key: "Téléphone", value: "20000001" }] }),
      SECRET,
    );
    assert.equal(ship.phoneHash, note.phoneHash);
    assert.ok(ship.phoneHash);
  });

  it("no phone anywhere => null hash", () => {
    assert.equal(normalizeOrder(baseOrder(), SECRET).phoneHash, null);
  });

  it("voided after fulfillment => RETURNED, fulfilledAt from the earliest SUCCESS fulfillment", () => {
    const n = normalizeOrder(
      baseOrder({
        cancelledAt: "2026-10-07T11:50:12Z",
        cancelReason: "CUSTOMER",
        displayFinancialStatus: "VOIDED",
        displayFulfillmentStatus: "FULFILLED",
        fulfillments: [
          { createdAt: "2026-10-05T12:00:00Z", status: "SUCCESS" },
          { createdAt: "2026-10-04T12:00:00Z", status: "CANCELLED" },
          { createdAt: "2026-10-06T12:00:00Z", status: "SUCCESS" },
        ],
      }),
      SECRET,
    );
    assert.equal(n.lifecycle, "RETURNED");
    assert.equal(n.fulfilledAt?.toISOString(), "2026-10-05T12:00:00.000Z");
    assert.equal(n.cancelReason, "CUSTOMER");
  });

  it("a cancelled-only fulfillment does not make the order IN_TRANSIT", () => {
    const n = normalizeOrder(
      baseOrder({ fulfillments: [{ createdAt: "2026-10-05T12:00:00Z", status: "CANCELLED" }] }),
      SECRET,
    );
    assert.equal(n.fulfilledAt, null);
    assert.equal(n.lifecycle, "PLACED");
  });

  it("maps refunds", () => {
    const n = normalizeOrder(
      baseOrder({
        displayFinancialStatus: "PARTIALLY_REFUNDED",
        refunds: [
          {
            id: "gid://shopify/Refund/9",
            createdAt: "2026-10-10T10:00:00Z",
            note: "damaged",
            totalRefundedSet: { shopMoney: { amount: "30.0", currencyCode: "TND" } },
          },
        ],
      }),
      SECRET,
    );
    assert.equal(n.lifecycle, "PARTIALLY_REFUNDED");
    assert.equal(n.refunds[0]!.shopifyRefundId, "9");
    assert.equal(n.refunds[0]!.amount, "30.0");
  });

  it("tolerates missing optional fields", () => {
    const n = normalizeOrder(
      {
        id: "gid://shopify/Order/1",
        name: "#1",
        createdAt: "2026-10-01T00:00:00Z",
        cancelledAt: null,
        cancelReason: null,
        displayFinancialStatus: null,
        displayFulfillmentStatus: null,
        tags: [],
        customAttributes: [],
        totalPriceSet: { shopMoney: { amount: "10.0", currencyCode: "TND" } },
      },
      SECRET,
    );
    assert.equal(n.lifecycle, "PLACED");
    assert.deepEqual(n.lines, []);
    assert.equal(n.attribution.method, "NONE");
    assert.equal(n.totalRefunded, "0");
  });
});

describe("phone helpers", () => {
  it("normalizePhone", () => {
    assert.equal(normalizePhone("+216 20 000 001"), "20000001");
    assert.equal(normalizePhone("00216 20000001"), "20000001");
    assert.equal(normalizePhone("216 20000001"), "20000001");
    assert.equal(normalizePhone("20-000-001"), "20000001");
    assert.equal(normalizePhone("123"), null);
    assert.equal(normalizePhone(null), null);
  });
  it("normalizeEmail", () => {
    assert.equal(normalizeEmail("  A@B.com "), "a@b.com");
    assert.equal(normalizeEmail("nope"), null);
  });
  it("hashIdentifier depends on the secret and refuses an empty one", () => {
    assert.notEqual(hashIdentifier("20000001", "s1"), hashIdentifier("20000001", "s2"));
    assert.equal(hashIdentifier(null, "s1"), null);
    assert.throws(() => hashIdentifier("20000001", ""));
  });
  it("gidToId", () => {
    assert.equal(gidToId("gid://shopify/Order/123"), "123");
    assert.equal(gidToId("123"), "123");
  });
});

describe("settings", () => {
  it("merges overrides, ignores junk", () => {
    const s = mergeSettings({ stale_days: 10, nope: 5, final_after_days: "x", recheck_days: NaN });
    assert.equal(s.stale_days, 10);
    assert.equal(s.final_after_days, SETTING_DEFAULTS.final_after_days);
    assert.equal(s.recheck_days, SETTING_DEFAULTS.recheck_days);
  });
});
