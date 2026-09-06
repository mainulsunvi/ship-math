# 007 — Carrier Service Rate Engine

## 1. Problem statement

The Carrier Service API generates new rates by calling our endpoint, and requires
CCS (FEATURES §2). This engine computes flat, free, tiered, per-unit incremental,
percentage, and handling-fee rates with presentment-currency awareness, applying them
only to zones the destination matches (004) and rules whose conditions hold (005).
It must respond fast, never break checkout, and degrade to a fallback rate on any
internal failure.

## 2. Data model decision

Amended 2026-09-05 (schema v2): `Shop.carrierServiceId` (nullable GID) stores the
registered carrier service — see architecture.md §A3 for the lifecycle (single
instance, go-live-gated, no syncedAt counterpart) and 002's amendment. Otherwise
no schema change. Carrier identity/credentials: none needed — Shopify identifies
the calling shop in the callback payload. Every callback is logged to `RequestLog`
(source `CARRIER_CALLBACK`, with bounded input snapshot — 002 v2).

- Read path: callback → verify authenticity → load shop row + enabled `CARRIER_RATE`
  rules + zones (Prisma) → evaluate → respond.
- Write path: `RequestLog` insert per call (fire-and-forget with error swallow);
  registration lifecycle via `carrierServiceCreate`/`carrierServiceDelete`.

**Decisions:**
- Registration is **gated on test mode**: `Shop.testMode` false + plan CCS-eligible →
  Settings "Go live" button creates the carrier service; enabling test mode deletes it.
  The callback URL is `<app_url>/carrierrates` (public route, no `authenticate.admin`).
- **Auth:** verify `X-Shopify-Hmac-Sha256` over the raw body when present **and**
  require the payload `rate.origin_shop_domain` (callback field) to match an installed
  `Shop` row; on any mismatch return `200` with a single fallback rate (never 4xx to
  avoid retry storms — see open question 2).
- **Fallback rate:** when test mode leaked a call, shop missing, or engine errors —
  respond `{ rates: [] }` (let Shopify show stock rates) — decision: empty-rates
  fail-open instead of a synthetic price, so we never invent charges merchants didn't
  configure. (FEATURES' "graceful fallback rate — never return an error that blocks
  checkout" is satisfied by a 200 + empty list.)
- **Timeouts:** target p95 < 500ms server-side; hard internal budget 1500ms with the
  empty-rates response emitted at deadline.

**Rate math (decision, unit-tested in 008's shared suite):**
1. Base: `flat` amount, or `free` (0), or tiered table lookup on weight/subtotal/qty bands, or `percentage` of cart subtotal.
2. Incremental: `per_item_amount × max(0, qty − free_items)` or `per_weight_amount × weight`.
3. Add handling fee (`handling_fee`) last; optional `cap` clamps the final value.
4. Currency: compute in shop currency; if the callback's `rate.currency` differs,
  convert using Shopify presentment rates if provided in payload, else return the
  shop-currency rate unchanged with `currency` set accordingly (see open question 3).

## 3. Admin GraphQL operations

- `CREATE_CARRIER_SERVICE` — `carrierServiceCreate(name: "ShipMath", callbackUrl, supportsServiceDiscovery: false, ...)` in `app/graphql/carrier.ts`. Called once per shop on go-live; on error the Settings action surfaces the message (feeds 003's probe logic).
- `DELETE_CARRIER_SERVICE` — teardown for test-mode flips and uninstall cleanup.
- `LIST_CARRIER_SERVICES` — Settings diagnostic ("registered: yes/no").
- Cost: single calls, no loops. ⚠️ Requires `write_shipping` (from 001).

## 4. Access scopes required

Amended 2026-09-05: current toml carries `read_products,
read_delivery_customizations, write_delivery_customizations` (001 amendment).
When 007 implementation starts, add `read_shipping, write_shipping` in ONE batch
(accept the dev-store reauth prompt then — do not split scope changes across
plans).

## 5. Webhook topics consumed

None new. Uninstall teardown: `app/uninstalled` handler additionally best-effort
deletes the carrier service (offline token may already be revoked — tolerate failure).

## 6. File-by-file change list

- `app/routes/carrierrates.tsx` — public action (POST only): HMAC/domain verify → evaluate → JSON response; no Polaris UI.
- `app/lib/carrier/verify.ts` — `verifyCarrierCallback(request, rawBody)` declaration.
- `app/lib/carrier/engine.ts` — `computeRates(rules, zones, cartCtx): RateResult[]` pure engine implementing the math above; shared with the simulator (008).
- `app/lib/carrier/respond.ts` — response shaping + `emptyRatesResponse()`.
- `app/graphql/carrier.ts` — three operations above.
- `app/routes/app.settings.tsx` — "Go live / enter test mode" section with registration status, wired via `useFetcher`.
- `app/components/settings/GoLiveCard.tsx` — reusable status + action card.

## 7. Acceptance criteria

1. Signed callback for an installed live shop returns computed rates for: flat, free-over-threshold, weight tier, per-item incremental, percentage, and handling-fee cases — each covered by a table-driven unit test of `computeRates`.
2. Cap math clamps after handling fee (unit test).
3. Unsigned request / unknown domain / test-mode shop → 200 + empty rates; no 4xx/5xx in any failure path (integration test with malformed HMAC).
4. Simulated 1500ms internal budget breach yields the empty-rates response (test with injected delay).
5. Go-live creates the carrier service (GraphQL recorded); entering test mode deletes it; Settings shows registration state via `LIST_CARRIER_SERVICES`.
6. Every live callback writes a `RequestLog` row with matched rule ids in order and latency.
7. Currency: a callback requesting a non-shop currency returns rates labeled with the emitted currency per decision above (unit test with fixture payloads).
8. Uninstall best-effort deletes the carrier service; callback after uninstall returns empty rates (shop row gone).

## 8. Open questions

1. Does the Carrier Service callback include `X-Shopify-Hmac-Sha256`? Verify against current docs during implementation; if absent, domain-allowlist against installed shops is the gate (log discrepancy loudly).
2. Confirm empty-rates fail-open is acceptable for review (vs a configurable fallback price) — decision defaults to fail-open; a future setting may add synthetic fallback (019).
3. FX conversion source if presentment rates aren't in the payload: defer multi-currency guarantee to 016/017? MVP: label honestly, don't convert on our own rates.

## Standard scenarios

- **Uninstall → reinstall:** shop row cascade stops rate serving instantly; carrier service deletion best-effort; reinstall = fresh registration via wizard/go-live.
- **Plan downgrade (losing CCS):** Shopify stops calling the callback; PlanBanner (003) guides to Functions path; rate rules remain configured but inert — Settings explains why.
- **Partial webhook failure/retry:** no new webhooks; carrier calls are synchronous — retry behavior is Shopify's timeout policy, covered by the fail-open + budget criteria.
- **Large catalog:** callback payload is cart-shaped, not catalog-shaped; engine cost is rules × lines. A 60-line cart is the perf fixture (criterion 4 budget test).
