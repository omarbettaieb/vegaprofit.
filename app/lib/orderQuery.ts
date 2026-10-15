// GraphQL documents for order sync. Validated against Shopify's Admin API on 15 Oct 2026.
// Deliberately NOT tagged with `#graphql`: that marker is picked up by the template's codegen.
//
// Cost note: lineItems(first: 20) with a page size of 10 orders keeps the requested query cost well
// under Shopify's 1000-point single-query limit. Orders with more than 20 distinct line items would
// be truncated, which is far beyond what a supplement store sells.

export const ORDER_FIELDS = `
  fragment OrderFields on Order {
    id
    name
    createdAt
    cancelledAt
    cancelReason
    displayFinancialStatus
    displayFulfillmentStatus
    tags
    customAttributes { key value }
    phone
    email
    shippingAddress { phone }
    billingAddress { phone }
    customer { id }
    totalPriceSet { shopMoney { amount currencyCode } }
    totalRefundedSet { shopMoney { amount currencyCode } }
    totalShippingPriceSet { shopMoney { amount currencyCode } }
    totalDiscountsSet { shopMoney { amount currencyCode } }
    customerJourneySummary {
      ready
      firstVisit { landingPage source utmParameters { source medium campaign content term } }
      lastVisit { landingPage source utmParameters { source medium campaign content term } }
    }
    fulfillments { createdAt status }
    lineItems(first: 20) {
      nodes {
        id
        title
        quantity
        sku
        variant { id }
        product { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        totalDiscountSet { shopMoney { amount currencyCode } }
      }
    }
    refunds { id createdAt note totalRefundedSet { shopMoney { amount currencyCode } } }
  }
`;

export const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes { ...OrderFields }
    }
  }
  ${ORDER_FIELDS}
`;

export const ORDER_BY_ID_QUERY = `
  query OrderById($id: ID!) {
    order(id: $id) { ...OrderFields }
  }
  ${ORDER_FIELDS}
`;

export const ORDERS_PAGE_SIZE = 10;
