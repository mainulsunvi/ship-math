# 019 — Scale & Reliability

> Status: **future / post-MVP**. Depends on: 007 (engine), 013 (providers), 017 (analytics volume).

## 1. Problem statement

FEATURES §4.7: edge-cached rate responses, idempotent rate keys, per-shop rate
limiting, circuit breakers on carrier APIs, and a public status/uptime page. This
spec hardens the engine for Plus-scale shops (200k rate calls) and for the live
carrier integrations from 013.

## 2. Data model decision

- `RateCacheEntry` (edge/CDN or Redis; TTL keyed on config-version + inputDigest
  from 002 — config changes invalidate the whole space in O(1) via version bump).
- Idempotent rate keys: response includes `request_id`-derived key; duplicate
  deliveries within TTL return the cached body.
- Per-shop limiter: token bucket in Redis (or DB-backed for MVP-grade infra),
  configured per plan tier.
- Circuit breaker: rolling failure-window counters per provider per shop,
  half-open probes.

## 3. Admin GraphQL operations

None.

## 4. Access scopes required

None new.

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/lib/scale/cache.ts` — cache layer abstraction (in-memory dev, Redis prod).
- `app/lib/scale/limiter.ts` — token bucket.
- `app/lib/scale/breaker.ts` — circuit breaker.
- `app/routes/carrierrates.tsx` — integrate cache/limiter/breaker around 007's engine.
- Status page: static site in `/status` project (external), fed by uptime checks.

## 7. Acceptance criteria

1. Identical callback within TTL returns byte-identical cached response; cache hit < 50ms.
2. Config change bumps version and invalidates (next call recomputes).
3. Limiter sheds load per shop without affecting other shops (isolation test).
4. Breaker opens after N consecutive provider failures; half-open probe recovers correctly.
5. Zero-rate alerting (016) does not fire from limiter-shed requests.
6. Status page reflects real health endpoints (synthetic check).

## 8. Open questions

1. Redis provider/region — infra decision tied to 001's hosting question.
2. Cache privacy: cached bodies contain rate prices only (no PII) — confirm acceptable for shared edge.

## Standard scenarios

- **Uninstall/reinstall:** cache space keyed by shop domain — purge on uninstall webhook.
- **Plan downgrade:** limiter tiers adjust; excess requests get fail-open empty rates, never errors.
- **Partial webhook failure/retry:** rate-key idempotency makes Shopify retries cheap.
- **Large catalog:** the whole spec exists for this — criteria 1–4 define the bar.
