// CSV builder (pure). Quotes fields that need it and defuses spreadsheet formulas (=, +, -, @ at the start).

export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : "") : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
