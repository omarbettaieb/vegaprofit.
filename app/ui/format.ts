import { formatTnd } from "../lib/money.ts";

export const tnd = (n: number) => formatTnd(n);
export const tndOrDash = (n: number | null) => (n === null ? "-" : formatTnd(n));
export const roas = (n: number | null) => (n === null ? "-" : n.toFixed(2));
export const whole = (n: number) => formatTnd(Math.round(n)).replace(/\.00$/, "");
export const pct = (n: number | null, d = 0) => (n === null ? "-" : `${n.toFixed(d)}%`);
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Tunis" }) : "never");
