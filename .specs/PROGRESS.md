# ShipMath — Implementation Progress

Living checklist mapping specs → implemented code. Updated as work ships.

Legend: ✅ done · 🔄 partial · ⬜ not started · 📐 designed (plan ready, code pending)

---

## Design phase — 2026-09-05 (schema v2 + architecture A3–A6 + plans)

- ✅ Prisma schema v2 + migration `20260905123305_carrier_prefs_log_input`:
  `Shop.carrierServiceId`, `Shop.prefs`, `RequestLog.input`, source index.
- ✅ architecture.md §A3 (carrier lane: registration, callback contract, lane
  capability matrix, rate math, logging), §A4 (simulator parity, module purity
  boundary, explainRules), §A5 (prefs + derived onboarding state), §A6 (AI
  boundaries). Resolved spec OQs: 003 OQ-1 (CCS probe = create+delete), 003 OQ-2
  (displayName heuristic defaults), 007 OQ-2 (fail-open empty rates confirmed),
  009 OQ-2 (destructive allowed behind extra confirm).
- ✅ Spec amendments: 002 (schema v2), 007 (carrierServiceId + scope batching),
  001/006 (earlier: delivery_customizations scopes).
- ✅ Implementation plans for GLM-4.7: `.specs/plans/000` (master order:
  004/005 → 007 → 008 → 003 → 009 → 010, gates + scope warnings) + per-spec plans.

---

## 001 — Foundation & embedded shell — ✅ (pre-existing)

## 002 — Data model & config store — ✅ (this lane)

- ✅ Prisma models: `Shop`, `Zone`, `ShippingRule`, `RequestLog`, `AuditLog`, `AiUsageDay`
  (migration `20260905115138_function_config_store`)
- ✅ `app/lib/config-schema.ts` — stored + wire Zod schemas (`FunctionConfigSchema`,
  `InputVariablesSchema` ≤ 100 tags/list)
- ✅ `app/lib/function-config.ts` — `buildFunctionConfig` (wire JSON, ≤ 9,500-byte
  cap, `ConfigTooLargeError`), `pushFunctionConfig` (`metafieldsSet` on the owner:
  `function-configuration` + `input-variables`)
- ✅ `app/db.server.ts` — `getOrCreateShop`, `countFunctionRules`, `isFunctionSyncStale`
- ✅ `app/graphql/metafields.ts` — `SET_FUNCTION_METAFIELDS`, `GET_FUNCTION_METAFIELDS`

## 006 — Delivery customization Function — ✅ (this lane)

- ✅ Shared pure evaluators bundled into the WASM: `app/lib/zone-matching.ts`,
  `app/lib/rule-evaluation.ts` (imported relatively from the extension; verified
  through the Javy/esbuild build)
- ✅ `app/services/function-owner.ts` — `ensureFunctionOwner` (idempotent create/verify)
- ✅ `app/routes/app._index.tsx` — sync dashboard: owner status, byte budget meter,
  seed-sample-rules action, test-mode toggle, stale banner
- ✅ `extensions/delivery-customization/src/cart_delivery_run.graphql` — input query
  with `$pt`/`$ct` tag variables + `c1` chunk alias (est. cost ≈ 29/30)
- ✅ `shopify.extension.toml` — `[extensions.input.variables]` → `input-variables`
- ✅ `extensions/delivery-customization/src/cart_delivery_run.ts` — guarded wire-config
  parse (incl. chunk manifest), CartFacts builder, per-delivery-group evaluation,
  HIDE/RENAME/MOVE operations, fail-open semantics
- ✅ `app/graphql/delivery-customization.ts` — create/list/update (toolkit-validated)
- ✅ Fixture suite (8): no-operations, rename, hide, move, test-mode, chunked,
  zone-match, zone-miss — `pnpm --filter delivery-customization test` ✅
- ✅ `pnpm exec tsc --noEmit` clean

## 003 — Setup wizard — 📐 plan ready (`plans/003-plan.md`; owner bootstrap hooks exist in `ensureFunctionOwner`)

## 004 — Zone & postal targeting — 🔄 (matching engine done + fixture-tested;
UI editor designed — `plans/004-005-plan.md`)

## 005 — Rule builder UX — 📐 plan ready (seed action + status page shipped)

## 007 — Carrier service engine — 📐 plan ready (action schema lands with 004/005 Task 5)

## 008 — Test-mode simulator & log — 📐 plan ready (testMode flag wired through mirror +
Function; simulator UI pending)

## 009 — AI assistant — 📐 plan ready (needs env keys before coding)

## 010 — Review kit — 📐 plan ready (needs hosting URL before final docs)

---

## Verified platform facts bank (2026-09-05)

- Owner metafield is the only supported config carrier for Functions; shop metafields
  are not read from input queries.
- Functions receive `null` for metafield values > 10,000 bytes.
- Input query cost cap 30: metafield 3, hasTags 3, leaf 1 → full cart + 3 metafields
  ≈ 29/30; no room for more chunk slots.
- `hasTags(tags:$var)` is the ONLY way to read product/customer tags in Functions;
  variables come from ONE JSON metafield on the owner (`[extensions.input.variables]`),
  list variables ≤ 100 elements, declare nullable (null → empty tag lists, fail-open).
- Owner lifecycle mutations need `read/write_delivery_customizations` scopes
  (NOT `write_shipping`).
- MOVE operations must keep the cheapest shipping option first-selected (App Store
  prohibited-behavior rule).
