import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "./csv.ts";

test("quotes commas, quotes and newlines", () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("x\ny"), '"x\ny"');
  assert.equal(csvCell(null), "");
});

test("numbers are rounded to 3 decimals and negatives stay numbers", () => {
  assert.equal(csvCell(1.23456), "1.235");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell(NaN), "");
});

test("text that starts like a formula is defused", () => {
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell("-cmd"), "'-cmd");
});

test("toCsv writes a header and rows with CRLF", () => {
  assert.equal(toCsv(["a", "b"], [[1, "x"], [2, "y,z"]]), 'a,b\r\n1,x\r\n2,"y,z"\r\n');
});
