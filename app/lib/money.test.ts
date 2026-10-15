import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTnd, parseAmount } from "./money.ts";

test("parseAmount accepts plain, comma and spaced numbers", () => {
  assert.equal(parseAmount("12"), 12);
  assert.equal(parseAmount("12.5"), 12.5);
  assert.equal(parseAmount("12,5"), 12.5);
  assert.equal(parseAmount(" 1 250,75 "), 1250.75);
  assert.equal(parseAmount(0), 0);
  assert.equal(parseAmount("0"), 0);
});

test("parseAmount rejects junk, negatives and empties", () => {
  for (const bad of ["", "abc", "-3", "1.2.3", "12 TND", null, undefined, NaN, -1, {}]) {
    assert.equal(parseAmount(bad), null);
  }
});

test("parseAmount keeps at most three decimals", () => {
  assert.equal(parseAmount("1.23456"), 1.235);
});

test("formatTnd groups thousands and keeps two decimals", () => {
  assert.equal(formatTnd(1234.5), "1 234.50");
  assert.equal(formatTnd(0), "0.00");
  assert.equal(formatTnd(-98765.432), "-98 765.43");
});
