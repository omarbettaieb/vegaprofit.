import { createHmac } from "node:crypto";

// Phone and email are never stored raw. We store a keyed hash (HMAC-SHA256) so the same person
// can be recognised across orders (duplicate / fake detection) without keeping the number.
// A plain SHA-256 of an 8-digit Tunisian number could be brute-forced in seconds, hence the secret.

// Canonical digits for a phone number, or null when it is clearly not a phone number.
// Tunisian numbers are 8 digits; +216 / 00216 / 216 prefixes are stripped.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00216")) digits = digits.slice(5);
  else if (digits.startsWith("216") && digits.length === 11) digits = digits.slice(3);
  if (digits.length < 6) return null;
  return digits;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return e.includes("@") ? e : null;
}

export function hashIdentifier(normalized: string | null, secret: string): string | null {
  if (!normalized) return null;
  if (!secret) throw new Error("PII hash secret is empty");
  return createHmac("sha256", secret).update(normalized).digest("hex");
}
