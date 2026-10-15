// Defaults for every tunable number. Overrides live in the `Setting` table (key/value JSON).
// Verdict thresholds join this list in milestone 6.

export const SETTING_DEFAULTS = {
  stale_days: 7, // fulfilled but still PENDING after N days => "stale order" alert
  final_after_days: 14, // an order is treated as final only N days after creation
  duplicate_window_hours: 72, // same phone within N hours => possible duplicate
  recheck_interval_hours: 12, // catch-up sync runs when the last one is older than this
  recheck_days: 60, // catch-up looks back this many days
  fake_qty_threshold: 5, // fake-order heuristic: quantity at or above this...
  fake_ticket_multiple: 4, // ...and total at or above N x the median ticket
  fake_cancel_window_hours: 72, // ...and cancelled within N hours => "likely fake"
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = { [K in SettingKey]: number };

// Merge stored overrides over the defaults. Ignores unknown keys and non-finite numbers.
export function mergeSettings(overrides: Record<string, unknown> = {}): Settings {
  const out: Settings = { ...SETTING_DEFAULTS };
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    const v = overrides[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}
