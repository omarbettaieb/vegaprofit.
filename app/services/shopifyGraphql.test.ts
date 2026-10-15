import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adminQuery } from "./shopifyGraphql.server.ts";

const noWait = async () => {};

function fakeAdmin(responses: unknown[]) {
  let i = 0;
  const calls: { query: string; variables: unknown }[] = [];
  return {
    calls,
    graphql: async (query: string, options?: { variables?: unknown }) => {
      calls.push({ query, variables: options?.variables });
      const body = responses[Math.min(i++, responses.length - 1)];
      return { json: async () => body };
    },
  };
}

describe("adminQuery", () => {
  it("returns data and passes variables through", async () => {
    const admin = fakeAdmin([{ data: { ok: true } }]);
    const out = await adminQuery<{ ok: boolean }>(admin, "query {}", { a: 1 }, 6, noWait);
    assert.deepEqual(out, { ok: true });
    assert.deepEqual(admin.calls[0]!.variables, { a: 1 });
  });

  it("retries on THROTTLED then succeeds", async () => {
    const waits: number[] = [];
    const admin = fakeAdmin([
      { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] },
      { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] },
      { data: { ok: 1 } },
    ]);
    const out = await adminQuery(admin, "q", {}, 6, async (ms) => void waits.push(ms));
    assert.deepEqual(out, { ok: 1 });
    assert.equal(admin.calls.length, 3);
    assert.deepEqual(waits, [2000, 4000]);
  });

  it("gives up after maxRetries throttles", async () => {
    const admin = fakeAdmin([{ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }]);
    await assert.rejects(() => adminQuery(admin, "q", {}, 2, noWait), /Throttled/);
    assert.equal(admin.calls.length, 3);
  });

  it("throws on other GraphQL errors without retrying", async () => {
    const admin = fakeAdmin([{ errors: [{ message: "Field 'x' doesn't exist" }] }]);
    await assert.rejects(() => adminQuery(admin, "q", {}, 6, noWait), /doesn't exist/);
    assert.equal(admin.calls.length, 1);
  });

  it("waits for the cost bucket when it cannot cover the next query", async () => {
    const waits: number[] = [];
    const admin = fakeAdmin([
      {
        data: { ok: 1 },
        extensions: {
          cost: { requestedQueryCost: 700, throttleStatus: { currentlyAvailable: 200, restoreRate: 100 } },
        },
      },
    ]);
    await adminQuery(admin, "q", {}, 6, async (ms) => void waits.push(ms));
    assert.deepEqual(waits, [5000]); // (700-200)/100 s
  });

  it("does not wait when the bucket is full enough", async () => {
    const waits: number[] = [];
    const admin = fakeAdmin([
      {
        data: { ok: 1 },
        extensions: {
          cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 900, restoreRate: 100 } },
        },
      },
    ]);
    await adminQuery(admin, "q", {}, 6, async (ms) => void waits.push(ms));
    assert.deepEqual(waits, []);
  });
});
