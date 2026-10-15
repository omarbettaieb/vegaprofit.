// Parse an amount typed by a person ("12", "12.5", "12,5", " 1 250,75 "). Returns null when it is not a
// non-negative finite number. Amounts are TND, three decimals at most are kept.
export function parseAmount(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? round3(input) : null;
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? round3(n) : null;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// "1 234.50" style display with 2 decimals.
export function formatTnd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${dec}`;
}
