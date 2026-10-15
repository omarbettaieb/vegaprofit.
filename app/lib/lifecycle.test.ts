import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countsInView,
  deriveLifecycle,
  isFinal,
  isReversed,
  isStale,
} from "./lifecycle.ts";

// Cases mirror real VegaLife orders seen on 15 Oct 2026 (names/phones removed).
describe("deriveLifecycle", () => {
  it("unfulfilled + PENDING => PLACED (#2124)", () => {
    assert.equal(
      deriveLifecycle({ cancelledAt: null, financialStatus: "PENDING", fulfillmentStatus: "UNFULFILLED" }),
      "PLACED",
    );
  });
  it("fulfilled + PENDING => IN_TRANSIT (#2126)", () => {
    assert.equal(
      deriveLifecycle({ cancelledAt: null, financialStatus: "PENDING", fulfillmentStatus: "FULFILLED" }),
      "IN_TRANSIT",
    );
  });
  it("PAID => DELIVERED (#2119)", () => {
    assert.equal(
      deriveLifecycle({ cancelledAt: null, financialStatus: "PAID", fulfillmentStatus: "FULFILLED" }),
      "DELIVERED",
    );
  });
  it("voided and never fulfilled => CANCELLED (#2121)", () => {
    assert.equal(
      deriveLifecycle({
        cancelledAt: "2026-10-13T08:02:36Z",
        financialStatus: "VOIDED",
        fulfillmentStatus: "UNFULFILLED",
      }),
      "CANCELLED",
    );
  });
  it("voided after fulfillment => RETURNED (#2092)", () => {
    assert.equal(
      deriveLifecycle({
        cancelledAt: "2026-10-07T11:50:12Z",
        financialStatus: "VOIDED",
        fulfillmentStatus: "FULFILLED",
      }),
      "RETURNED",
    );
  });
  it("uses fulfilledAt when the display status was reset", () => {
    assert.equal(
      deriveLifecycle({
        cancelledAt: "2026-10-07T11:50:12Z",
        financialStatus: "VOIDED",
        fulfillmentStatus: "UNFULFILLED",
        fulfilledAt: "2026-10-05T10:00:00Z",
      }),
      "RETURNED",
    );
  });
  it("REFUNDED wins even when cancelled", () => {
    assert.equal(
      deriveLifecycle({
        cancelledAt: "2026-10-07T11:50:12Z",
        financialStatus: "REFUNDED",
        fulfillmentStatus: "FULFILLED",
      }),
      "REFUNDED",
    );
  });
  it("PARTIALLY_REFUNDED stays partial", () => {
    assert.equal(
      deriveLifecycle({ cancelledAt: null, financialStatus: "PARTIALLY_REFUNDED", fulfillmentStatus: "FULFILLED" }),
      "PARTIALLY_REFUNDED",
    );
  });
  it("is case-insensitive", () => {
    assert.equal(
      deriveLifecycle({ cancelledAt: null, financialStatus: "paid", fulfillmentStatus: "fulfilled" }),
      "DELIVERED",
    );
  });
});

describe("views and reversal", () => {
  it("reversed lifecycles", () => {
    assert.equal(isReversed("CANCELLED"), true);
    assert.equal(isReversed("RETURNED"), true);
    assert.equal(isReversed("REFUNDED"), true);
    assert.equal(isReversed("PARTIALLY_REFUNDED"), false);
    assert.equal(isReversed("DELIVERED"), false);
  });
  it("gross counts all non-reversed, net counts delivered money only", () => {
    assert.equal(countsInView("PLACED", "gross"), true);
    assert.equal(countsInView("IN_TRANSIT", "gross"), true);
    assert.equal(countsInView("PLACED", "net"), false);
    assert.equal(countsInView("IN_TRANSIT", "net"), false);
    assert.equal(countsInView("DELIVERED", "net"), true);
    assert.equal(countsInView("PARTIALLY_REFUNDED", "net"), true);
    assert.equal(countsInView("CANCELLED", "gross"), false);
    assert.equal(countsInView("RETURNED", "net"), false);
  });
});

describe("stale and final", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  it("stale: in transit longer than staleDays", () => {
    assert.equal(isStale("IN_TRANSIT", "2026-10-07T12:00:00Z", now, 7), true);
    assert.equal(isStale("IN_TRANSIT", "2026-10-09T12:00:00Z", now, 7), false);
  });
  it("stale only applies to IN_TRANSIT", () => {
    assert.equal(isStale("DELIVERED", "2026-09-01T12:00:00Z", now, 7), false);
    assert.equal(isStale("IN_TRANSIT", null, now, 7), false);
  });
  it("final: needs age AND a settled lifecycle", () => {
    assert.equal(isFinal("DELIVERED", "2026-09-20T00:00:00Z", now, 14), true);
    assert.equal(isFinal("CANCELLED", "2026-10-10T00:00:00Z", now, 14), false);
    assert.equal(isFinal("IN_TRANSIT", "2026-08-01T00:00:00Z", now, 14), false);
    assert.equal(isFinal("PLACED", "2026-08-01T00:00:00Z", now, 14), false);
  });
});
