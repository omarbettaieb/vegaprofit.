# VegaProfit — decisions log

Status: Milestone 2 (Shopify sync). Updated 2026-10-15.

## Approved by Omar (14 Oct 2026)

### Order lifecycle (COD, manual flow)
Omar voids orders by hand and flips PENDING → PAID by hand. Shopify has no delivery events.

| Shopify state | App lifecycle |
|---|---|
| not cancelled, unfulfilled | PLACED |
| fulfilled + financial PENDING | IN_TRANSIT |
| financial PAID | DELIVERED (delivered and cash collected) |
| cancelled/VOIDED, never fulfilled | CANCELLED |
| cancelled/VOIDED, was fulfilled | RETURNED (refused or returned) |
| REFUNDED / PARTIALLY_REFUNDED | REFUNDED / PARTIALLY_REFUNDED |

- **Stale-order alert**: fulfilled and still PENDING after N days (default 7, setting `stale_days`).
- Reversals arrive late (9 minutes to 9+ days observed). Orders are treated as final only after 14 days (`final_after_days`).
- Net (real) view = DELIVERED only, minus refunds. Gross view = all non-cancelled.

### Verdict thresholds (multipliers of break-even CPA, all editable in Settings)
| Verdict | Rule |
|---|---|
| KILL | spend >= 2x break-even with 0 true orders; OR >= 10 true orders and true CPA > 1.5x |
| PAUSE | >= 10 orders and CPA 1.2x–1.5x; OR tracking health RED; OR early rule below |
| WATCH | < 10 orders; OR CPA 1.0x–1.2x; OR CPA 0.8x–1.0x (profitable, not strong enough to scale) |
| SCALE | >= 10 orders, CPA <= 0.8x, tracking not RED, reversal rate not rising. Suggest +20%, max once per 48h |
| CALENDAR | protected learning window (days 1–3), planned end date, seasonal window, or user-chosen review date |

Added after review of real data: **early rule** — if spend > 3x break-even and CPA > 2x break-even, mark PAUSE even with < 10 orders.
Example (C-Zinc Cure 3 mois, break-even 11.6 TND): KILL at 23 TND spend/0 orders or CPA > 17.4; SCALE at CPA <= 9.3.

### Calendar (CALENDAR verdict + Calendar page)
Omar confirmed: performance **day by day**, a **month view**, and a **custom date range**; plus review dates, planned campaign end dates (e.g. Octobre Rose 31 Oct) and verdict history.

### Measurement baseline
Omar stopped using EasySell and uses Meta Conversions API (sender not yet identified). Duplication measured **from 14 Oct 2026 onward** as the clean baseline; earlier data (Sep 21–Oct 13) showed Meta 67 purchases vs 50 Shopify orders (37 not cancelled), partly explained by EasySell.

## Technical decisions

- **Database**: PostgreSQL (not SQLite) so dev and prod match. Prisma ORM.
- **Jobs**: pg-boss (queue on the same Postgres) instead of BullMQ+Redis — one fewer service to host. Added in M2/M4.
- **Distribution**: `AppDistribution.SingleMerchant` (custom app on one store). Every table is `shop`-scoped so multi-store is a later config change, not a migration.
- **Scopes (read-only)**: read_orders, read_all_orders, read_products, read_customers, read_fulfillments. No write scopes (working rule 6).
- **PII**: phone and email are stored only as SHA-256 hashes (`phoneHash`, `emailHash`) for duplicate detection. Raw numbers are not persisted.
- **Money**: Decimal(14,3). Meta spend stored in USD, converted at read time with `FxRate` history.
- **Attribution inputs** (verified on real orders): (1) EasySell-style note attributes `utm_campaign`/`utm_term`/`utm_content` carry Meta ids; (2) Shopify `customerJourneySummary` UTMs; (3) landing URL parameters (`campaign_id`, `ad_id`). Mapping: campaign = `utm_campaign` (= `utm_id`), ad set = `utm_term`, ad = `utm_content`. Catalog Retargeting still sends a name in `utm_content` ("Facebook_UA") → recover ad id from landing URL `ad_id`, else `UtmNameMap`.
- **Webhooks** are NOT registered in M1 (handlers arrive in M2). Order topics need Protected customer data approval.
- **Event dedupe**: Meta dataset diagnostics were not readable (Ads MCP not enabled for the account). Event-level duplicate detection will use the Marketing API with Omar's token in M4/M5.

## Resolved 15 Oct 2026
- **Conversions API sender**: Shopify's native **Facebook & Instagram** sales channel (not a third party, not a custom server). It normally pairs browser and server events with one event id, so duplication is expected to be low from now on. Remaining sources: fake orders, repeat submissions, and Meta's attribution windows. Earlier duplication (Sep 21–Oct 13) was most likely EasySell.
- **Order #2123** (840 TND, 10x Marine Collagen, ad 120248559546940179) is a **fake customer**; already voided Oct 15. #2121 (840 TND, same ad, voided Oct 13) looks like the same pattern. Both were counted as Meta-attributed orders at creation.

## Added because of #2123
- `Order.excluded` + `excludedReason` (fake | test | spam | duplicate): excluded orders are removed from profit, true purchases, reversal rate and break-even. Manual toggle in the orders table (M2/M3). Default heuristic to *suggest* (never auto-apply): quantity >= 5 on a product whose normal ticket is much lower, voided within 72h, same ad as an earlier voided outlier.
- Fake orders pollute Meta too (Purchase events sent when the order is created). The Tracking health page will list excluded-but-counted-by-Meta orders as a cause of inflated Meta purchases.

## Milestone 2 decisions (15 Oct 2026)

### Deviations from the master prompt (flagged on purpose)
1. **Paginated GraphQL import instead of Bulk Operations.** Pages of 10 orders with cost-aware pacing. Simpler to build and debug, fine for a few thousand orders (a full import is minutes). Switch to Bulk Operations only if the store grows past ~20k orders or imports get slow.
2. **No background queue/cron yet.** Instead: webhooks for real-time changes, plus a **catch-up re-check of the last 60 days whenever the app is opened and the last check is older than 12 h** (and a manual button). Works on a laptop and on free hosts that sleep. A real scheduler (pg-boss) comes with hosting/hardening.
3. **No fulfillment webhooks.** Subscribed: orders/create, orders/updated, orders/cancelled, orders/edited, refunds/create. orders/updated already fires on fulfillment changes and the catch-up covers gaps. Avoids extra scope requirements.

### Design
- **Webhook = id only.** The handler reads the order id from the payload, re-fetches the order through the same GraphQL query as the import, and upserts. One mapper, idempotent, safe against duplicates and out-of-order delivery. Non-2xx on failure so Shopify retries.
- **Idempotent upsert.** Keyed by (shop, shopifyOrderId). Lines are replaced wholesale. Status history rows are written only on first sight and on lifecycle change. Manual fields (`excluded`, `excludedReason`, `possibleDuplicateOf` set by the flagger) are never overwritten by a sync.
- **Attribution precedence (last touch):** order note attributes > journey last visit > journey first visit > landing-URL parameters. A missing id inside a source (e.g. name in `utm_content`) is filled from that source's URL `ad_id`/`campaign_id`; remaining names go through the editable UtmNameMap. First and last visit differed on real orders, hence last touch.
- **PII:** phone and email are HMAC-SHA256 hashed with `PII_HASH_SECRET` (fallback `SHOPIFY_API_SECRET`). Plain hashes of 8-digit numbers are brute-forceable, hence the secret. Keep it stable. Raw numbers are never stored; raw note attributes (names, addresses) are never stored.
- **Lifecycle edge cases:** PAID => DELIVERED even if the order shows unfulfilled; RESTOCKED is not treated as fulfilled; refund rows with amount 0 (Shopify creates one on every cancellation, note "Order canceled") do not make an order REFUNDED, status comes from the financial state.
- **Duplicates/fake:** possible duplicates = same phone hash within 72 h (flag only). Fake suggestion needs BOTH quantity >= 5 and total >= 4x median ticket; "likely" if cancelled within 72 h, otherwise "review". Nothing is excluded without a click. Thresholds are settings.

### Shopify facts verified on 15 Oct 2026
- **Protected customer data:** custom apps get level 1 and level 2 (name, phone, email, address) automatically; no request needed (Shopify staff in the community thread; table in the protected-customer-data doc). The M1 README step asking to request it was wrong and is removed.
- **Custom distribution:** app must belong to a Partner organization; choose Custom distribution, enter the store domain, generate an install link, open it as the store owner. The choice is permanent. Alternative: create the app inside the store's own organization and install from its Installs card.
- **Dev store for `shopify app dev`:** believed required for the CLI preview; not confirmed in the docs read.
- Both GraphQL documents were executed read-only against the live store and return the expected shape.

### Verification status
- Pure logic (`app/lib`) and throttle handling: **69 tests pass** (`npm test`, plain Node) and strict `tsc` is clean on `app/lib` (checked in the build sandbox).
- Services, routes and the Sync page: written but **not type-checked or run** (packages cannot be installed in the build sandbox). Omar runs `npm run typecheck` locally.
- Not yet tested against a live Shopify install (needs the app installed; see README).

## Open items
1. **Pixel / dataset ID** still missing (needed from M4). 1630583147626333 is the *ad account* id. Events Manager > Data sources > dataset, or Shopify admin > Facebook & Instagram > Settings > data sharing.
2. **Hosting** for the always-on version: Render free web service + Neon free Postgres (do not use Render's own free Postgres, it expires after 30 days). The laptop is enough while building. Render free sleeps after 15 min idle (about 1 min to wake), which the catch-up re-check covers.
3. **Install path**: dev store first (fast feedback, free), then live store through custom distribution on a hosted URL.
4. `shopify.app.toml` has an empty `client_id` until `npm run config:link` writes it. Never overwrite a linked toml with the copy from an archive without re-checking `client_id`.
