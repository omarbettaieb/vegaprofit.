import type { Lifecycle, AttributionMethod } from "./types.ts";
import { deriveLifecycle } from "./lifecycle.ts";
import { resolveAttribution } from "./attribution.ts";
import type { UtmSet, Unresolved } from "./attribution.ts";
import { hashIdentifier, normalizeEmail, normalizePhone } from "./phone.ts";

// Pure mapping: Shopify Admin GraphQL order node -> data ready to upsert.
// No database or network access here, so it is fully unit-tested.

interface Money {
  shopMoney: { amount: string; currencyCode: string };
}
interface Visit {
  landingPage?: string | null;
  source?: string | null;
  utmParameters?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
  } | null;
}

export interface ShopifyOrderNode {
  id: string; // gid://shopify/Order/123
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  tags: string[];
  customAttributes: { key: string; value: string | null }[];
  phone?: string | null;
  email?: string | null;
  shippingAddress?: { phone?: string | null } | null;
  billingAddress?: { phone?: string | null } | null;
  customer?: { id: string } | null;
  totalPriceSet: Money;
  totalRefundedSet?: Money | null;
  totalShippingPriceSet?: Money | null;
  totalDiscountsSet?: Money | null;
  customerJourneySummary?: {
    ready?: boolean | null;
    firstVisit?: Visit | null;
    lastVisit?: Visit | null;
  } | null;
  fulfillments?: { createdAt: string; status: string }[] | null;
  lineItems?: {
    nodes: {
      id: string;
      title: string;
      quantity: number;
      sku?: string | null;
      variant?: { id: string } | null;
      product?: { id: string } | null;
      originalUnitPriceSet?: Money | null;
      totalDiscountSet?: Money | null;
    }[];
  } | null;
  refunds?: {
    id: string;
    createdAt: string;
    note?: string | null;
    totalRefundedSet: Money;
  }[] | null;
}

export interface NormalizedLine {
  shopifyLineId: string;
  productId: string | null;
  variantId: string | null;
  sku: string | null;
  title: string;
  quantity: number;
  unitPrice: string;
  discount: string;
}

export interface NormalizedRefund {
  shopifyRefundId: string;
  amount: string;
  note: string | null;
  refundedAt: Date;
}

export interface NormalizedOrder {
  shopifyOrderId: string;
  name: string;
  createdAtShopify: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
  financialStatus: string;
  fulfillmentStatus: string;
  fulfilledAt: Date | null;
  lifecycle: Lifecycle;
  currency: string;
  totalPrice: string;
  totalRefunded: string;
  shippingPrice: string;
  discountTotal: string;
  phoneHash: string | null;
  emailHash: string | null;
  customerId: string | null;
  tags: string[];
  rawUtm: UtmSet | null;
  landingUrl: string | null;
  attribution: {
    campaignId: string | null;
    adSetId: string | null;
    adId: string | null;
    method: AttributionMethod;
  };
  unresolved: Unresolved[];
  totalQuantity: number;
  lines: NormalizedLine[];
  refunds: NormalizedRefund[];
}

export function gidToId(gid: string): string {
  const i = gid.lastIndexOf("/");
  return i === -1 ? gid : gid.slice(i + 1);
}

function amount(m: Money | null | undefined): string {
  return m?.shopMoney?.amount ?? "0";
}

function phoneFromNoteAttributes(attrs: ShopifyOrderNode["customAttributes"]): string | null {
  for (const a of attrs ?? []) {
    const k = a.key.trim().toLowerCase();
    if (k === "téléphone" || k === "telephone" || k === "phone" || k === "tel") return a.value;
  }
  return null;
}

export function normalizeOrder(node: ShopifyOrderNode, hashSecret: string): NormalizedOrder {
  const financialStatus = node.displayFinancialStatus ?? "PENDING";
  const fulfillmentStatus = node.displayFulfillmentStatus ?? "UNFULFILLED";

  // Earliest successful fulfillment. Cancelled fulfillments do not count.
  const successful = (node.fulfillments ?? [])
    .filter((f) => f.status === "SUCCESS")
    .map((f) => new Date(f.createdAt).getTime());
  const fulfilledAt = successful.length ? new Date(Math.min(...successful)) : null;

  const lifecycle = deriveLifecycle({
    cancelledAt: node.cancelledAt,
    financialStatus,
    fulfillmentStatus,
    fulfilledAt,
  });

  const journey = node.customerJourneySummary;
  const toUtm = (v?: Visit | null): UtmSet | null => (v?.utmParameters ? { ...v.utmParameters } : null);
  const attr = resolveAttribution({
    noteAttributes: node.customAttributes,
    lastVisit: toUtm(journey?.lastVisit),
    firstVisit: toUtm(journey?.firstVisit),
    landingUrls: [journey?.lastVisit?.landingPage, journey?.firstVisit?.landingPage],
  });

  const phone = normalizePhone(
    node.phone ??
      node.shippingAddress?.phone ??
      node.billingAddress?.phone ??
      phoneFromNoteAttributes(node.customAttributes),
  );

  const lines: NormalizedLine[] = (node.lineItems?.nodes ?? []).map((l) => ({
    shopifyLineId: gidToId(l.id),
    productId: l.product?.id ? gidToId(l.product.id) : null,
    variantId: l.variant?.id ? gidToId(l.variant.id) : null,
    sku: l.sku ?? null,
    title: l.title,
    quantity: l.quantity,
    unitPrice: amount(l.originalUnitPriceSet),
    discount: amount(l.totalDiscountSet),
  }));

  return {
    shopifyOrderId: gidToId(node.id),
    name: node.name,
    createdAtShopify: new Date(node.createdAt),
    cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
    cancelReason: node.cancelReason,
    financialStatus,
    fulfillmentStatus,
    fulfilledAt,
    lifecycle,
    currency: node.totalPriceSet.shopMoney.currencyCode,
    totalPrice: amount(node.totalPriceSet),
    totalRefunded: amount(node.totalRefundedSet),
    shippingPrice: amount(node.totalShippingPriceSet),
    discountTotal: amount(node.totalDiscountsSet),
    phoneHash: hashIdentifier(phone, hashSecret),
    emailHash: hashIdentifier(normalizeEmail(node.email), hashSecret),
    customerId: node.customer?.id ? gidToId(node.customer.id) : null,
    tags: node.tags ?? [],
    rawUtm: attr.rawUtm,
    landingUrl: attr.landingUrl,
    attribution: {
      campaignId: attr.campaignId,
      adSetId: attr.adSetId,
      adId: attr.adId,
      method: attr.method,
    },
    unresolved: attr.unresolved,
    totalQuantity: lines.reduce((n, l) => n + l.quantity, 0),
    lines,
    refunds: (node.refunds ?? []).map((r) => ({
      shopifyRefundId: gidToId(r.id),
      amount: amount(r.totalRefundedSet),
      note: r.note ?? null,
      refundedAt: new Date(r.createdAt),
    })),
  };
}
