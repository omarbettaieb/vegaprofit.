# VegaProfit

Custom Shopify profit analytics (Profitario-style) for VegaLife, plus a Meta-ads truth layer and decision engine (KILL / PAUSE / WATCH / CALENDAR / SCALE) and Shopify↔Meta reconciliation. Built on the official Shopify React Router app template.

Status: **complete (milestones 1 to 8).** Live at https://vegaprofit.onrender.com, installed on dfafa4.myshopify.com. Approved rules and open items: `docs/DECISIONS.md`.

## Pages
| Page | What it answers |
|---|---|
| Profit | Day by day profit, gross or net, before and after ads |
| Real revenue | What Meta says vs what customers ordered vs what is still standing after cancellations, returns and fakes |
| Meta ads | Spend, Meta purchases, true orders, true cost per order, break-even, tracking light, daily duplicate check |
| Decisions | One verdict per campaign / ad set / ad: KILL, PAUSE, WATCH, CALENDAR, SCALE (all thresholds editable) |
| Calendar | Review dates, campaign end dates, seasonal windows; day, month and range views |
| Costs | Product costs, courier fees, USD to TND rate, other expenses |
| Export | CSV of profit, Meta truth tables and orders (no customer data) |
| Health check | Is the token alive, are orders in sync, what is missing |
| Orders sync | Import / re-check orders, review fake and duplicate suspects |

> **Verification.** `npm test` (106 tests, plain Node) covers every calculation: lifecycle, attribution, profit, truth layer, verdicts, reconciliation, CSV. Pages and services are type-checked by `npm run typecheck` on a machine with the packages installed.

## 1. First run on your machine
Requirements: Node >= 22.12, Docker, Shopify CLI (`npm i -g @shopify/cli`).

```bash
cd app
cp .env.example .env          # set POSTGRES_PASSWORD, keep DATABASE_URL in sync
npm install
docker compose up -d db       # Postgres on localhost:5432
npx prisma validate           # schema sanity check
npx prisma migrate dev --name init
npm run typecheck
```
If `prisma validate` or `typecheck` reports errors, send me the output and I will fix them.

## 2. Install on Shopify (what was actually done)
The app uses **custom distribution** (permanent choice): Partner dashboard, app, Distribution, Custom distribution, enter the store domain, generate the install link, open it as the store owner. The dev-store preview (`npm run dev`) refuses the Order object, so do not use it for this app; release config changes with `npx shopify app deploy`.
Scopes (read-only): read_orders, read_products, read_customers, read_fulfillments. `read_all_orders` and order webhooks need Shopify's protected-data approval and are not enabled: the app sees the last 60 days and re-checks them when you open it.

## 2b. Tests
`npm test` runs the pure-logic tests with plain Node (no packages needed beyond Node itself).

## 3. Hosting (zero cost)
Render free web service (Docker, auto-deploys on every push to GitHub) plus Neon free Postgres. Render sleeps after 15 minutes idle; the first open takes about a minute. The container runs `prisma migrate deploy` on start.
Environment variables on Render: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES, SHOP_CUSTOM_DOMAIN, PII_HASH_SECRET, DATABASE_URL, META_ACCESS_TOKEN, META_AD_ACCOUNT_ID. Never commit them.

## 4. Meta access
Business settings, Users, System users: create `vegaprofit` (Employee), give it the ad account with **View performance**, assign it an app role (Full control on the app), generate a token that never expires with only `ads_read`. Put it in Render as `META_ACCESS_TOKEN` with `META_AD_ACCOUNT_ID`. Meta days follow the ad account timezone. Spend is stored in USD and converted with the rate typed on the Costs page.
If the token stops working the Health check says so; generate a new one and replace the variable.

## 5. Recommended Meta URL parameters
Keep IDs in the UTMs so attribution is exact:
```
utm_source=facebook&utm_medium=paid&utm_id={{campaign.id}}&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}&campaign_id={{campaign.id}}&ad_id={{ad.id}}
```
Old ads that use a name in `utm_content` (e.g. `Facebook_UA`) fall back to the landing-URL `ad_id`, then to the UTM name map.

## Roadmap
1 Scaffold (this) · 2 Shopify sync + lifecycle · 3 Costs + profit engine · 4 Meta spend + attribution · 5 Truth layer · 6 Decision engine + calendar · 7 Reconciliation · 8 Reports/hardening.
Each milestone stops for your "go".

## Tests
See section 2b.

## UI and public demo (M9)

Design system: `app/ui/theme.ts` (one stylesheet) and `app/ui/kit.tsx` (shell, KPI strip, claimed-vs-proven bars, SVG charts).
Pages are presentational views in `app/views/`, used by both the real routes (`/app/...`) and the public demo (`/demo/...`).
The demo needs no login and no database: `app/lib/demoData.ts` generates a fictional store and runs it through the real engines.
Opening the site root without `?shop=` redirects to `/demo`.
