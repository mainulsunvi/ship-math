# 006 — Delivery Customization Function

## 1. Problem statement

The Functions layer is ShipMath's head start: it works on every Shopify plan with no
CCS requirement and is faster to build and review than the carrier engine (FEATURES
§2). This Function hides, renames, and reorders delivery options at checkout based on
the merchant's rules (005) and zones (004), reading its configuration from the
app-owned metafield on the **function owner** (002 / `architecture.md` §A1).
It must never error in a way that breaks checkout.

## 2. Data model decision

No schema change (owner GID lives on `Shop.functionOwnerId`, 002). The Function is
configuration-pure: it reads the owner metafield (`$app:delivery-customization` /
`function-configuration`, type `json`, plus one reserved chunk slot
`function-configuration-1`) via its input query and applies `HIDE` / `RENAME` /
`MOVE` rules. **The Function never writes anywhere** — all writes stay in the Remix app.

- Read path: Function input query selects the owner metafield (live per checkout run —
  config changes apply at the next checkout with NO redeploy) → if primary jsonValue is
  a `{"v":1,"chunked":true,"parts":1}` manifest, parse the `c1` string chunk, else
  parse the primary value → evaluate rules against cart + delivery candidate context.
  Product/customer tag conditions use input-query **variables** (`pt`/`ct`) wired via
  `[extensions.input.variables]` to the owner's `input-variables` JSON metafield and
  consumed as `hasTags(tags:$pt)` / `hasTags(tags:$ct)` — the schema exposes no plain
  tags field on Product/Customer to Functions (variables are nullable → fail-open).
- Write path: unchanged (002's `pushFunctionConfig`, budgeted ≤ 9,500 bytes total —
  above 10,000 bytes Shopify returns `null` to the Function silently).

**Function owner lifecycle (app-managed, single instance):**
- Bootstrap at wizard completion / go-live: `deliveryCustomizationCreate(deliveryCustomization:
  { functionHandle: "delivery-customization", title: "ShipMath delivery rules", enabled: true })` →
  store returned GID on `Shop.functionOwnerId`.
- Idempotent: skip when a stored GID still resolves; if the merchant deleted the owner
  (visible in Settings > Shipping), the next settings load recreates it and resyncs config.
- Exactly ONE owner per shop (platform max is 25 active; we use 1). `ui.enable_create = false`
  in `shopify.extension.toml` hides the merchant-create path so duplicates can't fragment config.
- Settings surfaces the owner's enabled/disabled state; flipping it is a merchant action,
  surfaced like `functionSyncedAt` staleness.

**Decisions (updated 2026-09-05 after CLI scaffolding):**
- Extension scaffolded by Shopify CLI at `extensions/delivery-customization/`
  (TypeScript flavor, Javy toolchain — matches the existing `@shopify/shopify_function`
  + `javy` dependencies; no Rust toolchain requirement on the team).
- Target: `cart.delivery-options.transform.run` (the current target surface for
  delivery customization; replaces the legacy `delivery.customization.run`),
  `api_version = "2026-07"` as scaffolded in `shopify.extension.toml`. Webhooks stay
  on `2026-10` per `shopify.app.toml` — the two versions are independent.
- Supported conditions at checkout: cart subtotal, weight, item quantity, product tag,
  SKU, vendor, customer tag, logged-in state, destination (via zone match). Customer
  tag/logged-in availability depends on the target's input fields — see open question 2.
- Test mode: when the mirror's `testMode` flag is true, the Function returns **no
  operations** (pass-through) — merchants configure safely, simulator (008) previews.
- Behavior on missing/unparseable metafield: return no operations (fail-open, never
  break checkout) and emit a Function log line for diagnostics.

## 3. Admin GraphQL operations

None in the Function itself. Deployment is via `shopify app deploy` (CLI), not API.
The admin app's involvement:

- `CREATE_DELIVERY_CUSTOMIZATION` — owner bootstrap (above). Est. cost: once per shop.
- `LIST_DELIVERY_CUSTOMIZATIONS` — resolve stored GID / detect merchant deletion (also
  powers the Settings status surface). Est. cost: 1 per settings load, no loops.
- `UPDATE_DELIVERY_CUSTOMIZATION` — optional convenience to re-enable a merchant-disabled
  owner (behind an explicit button; never auto-fight the merchant).
- Mirror writes stay in 002 (`SET_FUNCTION_METAFIELD` on the owner GID).

## 4. Access scopes required

Amended 2026-09-05 (validator-confirmed): the owner lifecycle mutations in §3 require
`read_delivery_customizations, write_delivery_customizations` — added to
`shopify.app.toml` (see 001 §4). The Function's input-query reads of app-owned
metafields still need no metafield scope. Scope change ⇒ dev-store reauth prompt on
next `shopify app dev`.

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

Extension scaffolded via `shopify app generate extension --template delivery_customization
--flavor typescript` (do not re-scaffold; extend in place):

- `extensions/delivery-customization/shopify.extension.toml` — scaffolded: target
  `cart.delivery-options.transform.run`, `api_version 2026-07`, metafield input query wired.
- `extensions/delivery-customization/src/cart_delivery_options_transform_run.graphql` —
  input query (scaffolded): reads `$app:delivery-customization` / `function-configuration`;
  extend with cart lines (merchandise product fields, quantity, cost), destination, and
  buyer identity fields needed by conditions.
- `extensions/delivery-customization/src/cart_delivery_options_transform_run.ts` — pure
  `cartDeliveryOptionsTransformRun(input)` implementing condition evaluation + zone
  matching (port of the 004/005 evaluator logic into Function runtime — logic kept in a
  shared module compiled into the bundle).
- `extensions/delivery-customization/src/index.ts` — entry re-export (scaffolded).
- `extensions/delivery-customization/generated/api.ts` — codegen output
  (`@graphql-codegen/cli` devDependency at repo root is REQUIRED for regeneration —
  the Shopify CLI's typegen step invokes `graphql-code-generator`).
- `extensions/delivery-customization/tests/` + `vitest` — scaffolded test harness with
  JSON fixtures; add fixtures per acceptance criterion.
- `app/lib/function-config.ts` — shared mirror-JSON reader typing used by simulator for parity tests.
- `app/lib/__tests__/function-parity.test.ts` — runs the same inputs through the Function's exported `run` and the simulator's evaluator; outputs must match.
- `app/graphql/delivery-customization.ts` — `CREATE_DELIVERY_CUSTOMIZATION`, `LIST_DELIVERY_CUSTOMIZATIONS`, `UPDATE_DELIVERY_CUSTOMIZATION`.
- `app/services/function-owner.ts` — `ensureFunctionOwner(shopId)` bootstrap/heal routine (idempotent; called from wizard completion, settings loader when GID missing).

## 7. Acceptance criteria

1. `shopify app deploy` bundles the Function; installing on a dev store shows the delivery customization consent/entry.
2. A HIDE rule matching cart subtotal hides the targeted delivery option at checkout on a Basic-plan dev store (no CCS registered anywhere).
3. A RENAME rule changes the displayed title; a MOVE rule repositions an option (verify exact operation shape against current docs during implementation — see open question 1).
4. With `testMode` true, checkout shows stock behavior (no operations applied).
5. Deleting the metafield does not error checkout — Function returns no operations.
6. Function run completes under its execution budget on a 50-line cart (verified via CLI function logs).
7. Parity test: identical rule set + simulated cart produce identical decisions in Function `run` and simulator evaluator.
8. Uninstall removes the Function with the app; no residual script tags/config (Function lifecycle is app-bound).
9. Owner bootstrap is idempotent: completing the wizard twice, or loading Settings with a valid stored GID, results in exactly one delivery customization (assert via `LIST_DELIVERY_CUSTOMIZATIONS`).
10. After a merchant deletes the owner in Settings > Shipping, the next ShipMath settings load recreates it and resyncs config; checkout never errors in the gap (Function pass-through).
11. Changing a rule in the admin app is reflected at the NEXT checkout run without redeploying the Function (live owner-metafield read).

## 8. Open questions

1. ~~Operation shape~~ **Resolved 2026-09-05:** the scaffolded types (`generated/api.ts`)
   include `HideOperation`, `RenameOperation`, and `MoveOperation` — MOVE rules stay in
   scope for the UI (005). Verify `MoveOperation` position semantics (index vs
   relative) against the generated type when implementing.
2. **Buyer identity fields:** confirm availability of customer tag / logged-in state in the `cart.delivery-options.transform.run` input for the target API version; if absent, those conditions are editor-disabled with an explanatory tooltip.
3. **Collection-based conditions** (FEATURES lists collection): input does not expose collection membership — options: (a) app mirrors collection→product-tag hints into the metafield at config time, or (b) defer collections to 011 product groups. Default: defer, note in editor.

## Standard scenarios

- **Uninstall → reinstall:** Function is deleted with the app; reinstall redeploys and reads the (fresh) mirror — no stale-config risk since Prisma rows were cascaded.
- **Plan downgrade:** Functions work on all plans — this is the downgrade-safe core; the PlanBanner (003) steers merchants here when they lose CCS.
- **Partial webhook failure/retry:** no webhooks; Function input reads the metafield per-run, so a failed mirror write (002 stale flag) results in pass-through, not breakage.
- **Large catalog:** Function evaluates the configured rule set, not the catalog; cost scales with rule count and cart lines (criterion 6 caps behavior).
