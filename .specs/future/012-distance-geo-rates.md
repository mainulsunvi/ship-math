# 012 — Distance & Geo Rates

> Status: **future / post-MVP**. Depends on: 004 (zones), 007 (engine), 011 (config v2).

## 1. Problem statement

FEATURES §4.2: straight-line radius and driving-distance rates per location, shortest
vs fastest route selection, maximum deliverable distance with a clear "we don't
deliver here" state, per-location distance tiers, and a geocoding cache keyed on
normalized address for cost control. This is Zapiet's core; it is also the most
expensive feature to serve (every geocode/route lookup is a paid API call).

## 2. Data model decision

- `GeoCache` table: normalized address key → lat/lng, resolvedAt, provider. Unique on key.
- `DistanceTier` JSON on rule action: bands by km/mi with amounts.
- Origin coordinates on `Package`/location config (011).
- Rate action gains `distanceMode: STRAIGHT_LINE | DRIVING_SHORTEST | DRIVING_FASTEST`, `maxDistance`.

## 3. Admin GraphQL operations

None (locations read via existing scopes if origin sync needed).

## 4. Access scopes required

`read_locations` — **new scope → merchant reauthorization.** Flag loudly.

## 5. Webhook topics consumed

| Topic | Purpose | Idempotency key |
|---|---|---|
| `locations/update` | Sync origin coordinates | locationId + updatedAt |

## 6. File-by-file change list

- `app/lib/geo/geocode.ts` — provider abstraction + cache-first resolution.
- `app/lib/geo/distance.ts` — haversine + route provider adapter.
- `app/routes/app.settings.tsx` — geo provider key configuration section.
- Migration for `GeoCache`.
- Carrier engine integration point (budget: geo lookups must fit inside the 1500ms cap; cache hit required on warm paths).

## 7. Acceptance criteria

1. Haversine correctness unit-tested against known city pairs (±0.5%).
2. Cache hit rate ≥ 95% on repeated destinations in a simulation batch.
3. Beyond maxDistance → zero rates with explicit "outside delivery area" simulation trace.
4. Route-mode selection alters returned distance in a mocked-provider test.
5. Cache size bounded (LRU eviction at configurable cap) — memory/disk stable over 10k entries.
6. Carrier budget: cold geocode + route ≤ 1200ms p95 with provider stubs.

## 8. Open questions

1. Provider choice (Google/Mapbox/OSRM self-host) — cost/uptime tradeoff decides; metering note in FEATURES §6.3 applies (monthly plan only).
2. Address normalization spec for cache keys — reuse 004's postal normalization plus city/street folding?

## Standard scenarios

- **Uninstall/reinstall:** GeoCache cascades (GDPR: it is address-derived, non-PII-coded but treated as erasable).
- **Plan downgrade:** distance features are the cost-heavy tier — downgrade disables distance rules with explicit merchant notice.
- **Partial webhook failure/retry:** locations/update idempotent upserts.
- **Large catalog:** irrelevant; hot path is cache + provider latency.
