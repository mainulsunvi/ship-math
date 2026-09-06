# 017 — Analytics & Margin Reporting

> Status: **future / post-MVP**. Depends on: 008 (request log), 007 (engine).

## 1. Problem statement

FEATURES §4.6 + §8: rate impressions, selection rate per rate, abandonment at the
shipping step, shipping cost vs actual label cost variance. This is half of the
positioning wedge — "here is where you are losing money on shipping" — and depends
on request-log data accumulating in production.

## 2. Data model decision

- `RateEvent` table: shopId, requestId (links `RequestLog`), rate handle, presented
  amount, selected boolean, checkout outcome.
- Aggregates: `DailyRateStat` rollup table (shopId, day, rateId, impressions,
  selections) — nightly rollup job; viewer reads rollups, never raw events.
- Label-cost variance: merchant CSV upload of label costs joined on order id
  (`OrderShippingCost` table) — no carrier account integration required.

## 3. Admin GraphQL operations

- `orders` query filtered by shipping line title + date — paginated, cursor-based,
  backfill job capped per run (⚠️ cost: full-history backfill is expensive; limit to
  last 90 days by default).

## 4. Access scopes required

`read_orders` — **new scope → merchant reauthorization.** Flag loudly.

## 5. Webhook topics consumed

None new (order data pulled, not pushed, in v1 of this spec).

## 6. File-by-file change list

- Migrations: `RateEvent`, `DailyRateStat`, `OrderShippingCost`.
- `app/lib/analytics/rollup.ts` — nightly aggregation.
- `app/routes/app.analytics.tsx` + `app/components/analytics/*` — dashboard (charts via Polaris + lightweight chart lib).
- `app/lib/analytics/backfill.ts` — capped order backfill.

## 7. Acceptance criteria

1. Impressions/selection rates compute correctly on a seeded event fixture.
2. Rollup is idempotent per day (re-run safe).
3. Backfill respects the 90-day cap and paginates without throttle errors.
4. Variance report joins label CSV to order shipping cost with explicit unmatched-row handling.
5. Dashboard renders rollups only (raw-event query rejected by test).
6. Selection rate denominators exclude zero-rate checkouts.

## 8. Open questions

1. Chart library choice (bundle-size conscious) — Preact-chartjs vs hand-rolled SVG.
2. Abandonment attribution: shipping-step abandonment needs checkout events — confirm data availability via orders/pixel; may descope to proxy metric.

## Standard scenarios

- **Uninstall/reinstall:** analytics cascade (GDPR: order-derived aggregates treated as erasable on shop/redact).
- **Plan downgrade:** analytics is a Pro differentiator; downgrade freezes dashboards, keeps data 30 days.
- **Partial webhook failure/retry:** rollup idempotency covers job retries.
- **Large catalog:** irrelevant; order volume is the scale axis — rollup keeps viewer queries O(days), not O(events).
