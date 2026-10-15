import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findPossibleDuplicates, median, suggestFake } from "./duplicates.ts";

describe("findPossibleDuplicates", () => {
  it("flags the same phone 3 minutes apart (real pattern #2085/#2086)", () => {
    const m = findPossibleDuplicates(
      [
        { id: "A", createdAt: "2026-09-25T04:13:34Z", phoneHash: "h1" },
        { id: "B", createdAt: "2026-09-25T04:16:26Z", phoneHash: "h1" },
      ],
      72,
    );
    assert.equal(m.get("B"), "A");
    assert.equal(m.has("A"), false);
  });

  it("flags a re-order two days later inside the 72h window", () => {
    const m = findPossibleDuplicates(
      [
        { id: "A", createdAt: "2026-10-02T21:52:36Z", phoneHash: "h2" },
        { id: "B", createdAt: "2026-10-04T14:50:58Z", phoneHash: "h2" },
      ],
      72,
    );
    assert.equal(m.get("B"), "A");
  });

  it("does not flag outside the window", () => {
    const m = findPossibleDuplicates(
      [
        { id: "A", createdAt: "2026-10-01T00:00:00Z", phoneHash: "h3" },
        { id: "B", createdAt: "2026-10-09T00:00:00Z", phoneHash: "h3" },
      ],
      72,
    );
    assert.equal(m.size, 0);
  });

  it("ignores orders without a phone hash and different phones", () => {
    const m = findPossibleDuplicates(
      [
        { id: "A", createdAt: "2026-10-01T00:00:00Z", phoneHash: null },
        { id: "B", createdAt: "2026-10-01T00:05:00Z", phoneHash: null },
        { id: "C", createdAt: "2026-10-01T00:06:00Z", phoneHash: "x" },
        { id: "D", createdAt: "2026-10-01T00:07:00Z", phoneHash: "y" },
      ],
      72,
    );
    assert.equal(m.size, 0);
  });

  it("an excluded earlier order does not anchor a duplicate", () => {
    const m = findPossibleDuplicates(
      [
        { id: "A", createdAt: "2026-10-01T00:00:00Z", phoneHash: "h", excluded: true },
        { id: "B", createdAt: "2026-10-01T01:00:00Z", phoneHash: "h" },
      ],
      72,
    );
    assert.equal(m.size, 0);
  });

  it("works regardless of input order and chains to the closest earlier order", () => {
    const m = findPossibleDuplicates(
      [
        { id: "C", createdAt: "2026-10-01T03:00:00Z", phoneHash: "h" },
        { id: "A", createdAt: "2026-10-01T01:00:00Z", phoneHash: "h" },
        { id: "B", createdAt: "2026-10-01T02:00:00Z", phoneHash: "h" },
      ],
      72,
    );
    assert.equal(m.get("B"), "A");
    assert.equal(m.get("C"), "B");
  });
});

describe("median", () => {
  it("odd, even, empty", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([]), 0);
  });
});

describe("suggestFake", () => {
  const ctx = { medianTicket: 49, qtyThreshold: 5, ticketMultiple: 4, cancelWindowHours: 72 };

  it("10 units, 840 TND, cancelled within a day (#2121 pattern) => likely", () => {
    const s = suggestFake(
      {
        quantity: 10,
        totalPrice: 840,
        lifecycle: "CANCELLED",
        createdAt: "2026-10-12T18:22:03Z",
        cancelledAt: "2026-10-13T08:02:36Z",
      },
      ctx,
    );
    assert.equal(s.level, "likely");
    assert.ok(s.reasons.length >= 3);
  });

  it("same outlier cancelled after 57h (#2123 pattern) => likely", () => {
    const s = suggestFake(
      {
        quantity: 10,
        totalPrice: 840,
        lifecycle: "CANCELLED",
        createdAt: "2026-10-12T23:14:28Z",
        cancelledAt: "2026-10-15T08:29:13Z",
      },
      ctx,
    );
    assert.equal(s.level, "likely");
  });

  it("outlier still open => review, never automatic", () => {
    const s = suggestFake(
      { quantity: 10, totalPrice: 840, lifecycle: "PLACED", createdAt: "2026-10-12T23:14:28Z", cancelledAt: null },
      ctx,
    );
    assert.equal(s.level, "review");
  });

  it("outlier cancelled only after a week => review, not likely", () => {
    const s = suggestFake(
      {
        quantity: 10,
        totalPrice: 840,
        lifecycle: "CANCELLED",
        createdAt: "2026-10-01T00:00:00Z",
        cancelledAt: "2026-10-09T00:00:00Z",
      },
      ctx,
    );
    assert.equal(s.level, "review");
  });

  it("a normal single-unit order => none", () => {
    const s = suggestFake(
      { quantity: 1, totalPrice: 92, lifecycle: "DELIVERED", createdAt: "2026-10-01T00:00:00Z", cancelledAt: null },
      ctx,
    );
    assert.equal(s.level, "none");
  });

  it("big quantity alone (cheap item) or big ticket alone is not enough", () => {
    const qtyOnly = suggestFake(
      { quantity: 6, totalPrice: 120, lifecycle: "PLACED", createdAt: "2026-10-01T00:00:00Z", cancelledAt: null },
      ctx,
    );
    const ticketOnly = suggestFake(
      { quantity: 2, totalPrice: 300, lifecycle: "PLACED", createdAt: "2026-10-01T00:00:00Z", cancelledAt: null },
      ctx,
    );
    assert.equal(qtyOnly.level, "none");
    assert.equal(ticketOnly.level, "none");
  });

  it("no median yet (empty store) => none", () => {
    const s = suggestFake(
      { quantity: 10, totalPrice: 840, lifecycle: "PLACED", createdAt: "2026-10-01T00:00:00Z", cancelledAt: null },
      { ...ctx, medianTicket: 0 },
    );
    assert.equal(s.level, "none");
  });
});
