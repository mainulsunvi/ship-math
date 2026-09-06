# Plan — 007: Carrier Service Rate Engine + Go-Live

Spec: `.specs/007-carrier-service-engine.md` · Depends on: 004/005 plan (action
schema, zone repos). Architecture: §A3 (read it first — contract, matrix, math).
Estimate: 2–3 days.

## Task 0 — Scopes (one commit, then reauth)

`shopify.app.toml`: append `read_shipping, write_shipping` to scopes. Commit alone.
Next `shopify app dev` prompts the dev store to accept — do it before anything else.

## Task 1 — Rate action schema (`app/lib/carrier/action-schema.ts`)

If 004/005 Task 5 already created it, skip. Exactly the §A3 JSON: mode
(flat|free|tiered|percentage), amount?, percentage?, tiers?[], perItem?, perWeight?,
handlingFee?, cap?, serviceName, serviceCode, description?. Zod + `parseStoredJson`
reuse. Money = decimal strings.

## Task 2 — Pure engine (`app/lib/carrier/engine.ts`)

```ts
export interface CarrierCartContext {
  destination: { country: string; province: string | null; postal: string | null };
  currency: string;           // requested presentation currency
  subtotal: string;           // decimal, shop currency
  weightGrams: number;
  quantity: number;
  skus: string[]; vendors: string[];
}
export interface ComputedRate { serviceName: string; serviceCode: string; priceCents: string; description?: string }
export function computeRates(rules: CarrierRule[], zones: WireZone[], cart: CarrierCartContext): ComputedRate[];
```

`CarrierRule` = stored rule (kind CARRIER_RATE) with parsed conditions/action.
Pipeline per §A3: base → perItem → perWeight → handlingFee → cap → round-half-up
to cents (string). Conditions reuse `evaluateConditionGroup` + `matchesZone`
(shared modules — parity by construction, §A4). FIRST_MATCH/ALL_MATCH +
stopOnMatch semantics identical to the Function lane (`Shop.evaluationMode`).
Tiered lookup: bands inclusive of `from`, exclusive of `to` (last band open when
`to` omitted); non-numeric basis never matches a numeric band → rule fails.

Decimal helpers (`app/lib/money.ts`, pure): `addDecimals`, `multiplyDecimal`,
`clampMax`, `toCentsString` — string-based, no float math. **No `Number()`
arithmetic on money anywhere.**

Verify (vitest, table-driven per criterion 1–2 + 7): flat, free-over-threshold
(threshold via tiered subtotal band), weight tier, per-item with freeItems,
percentage, handling fee, cap-clamps-after-fee, currency labeling.

## Task 3 — Callback verification (`app/lib/carrier/verify.ts`)

```ts
export function verifyCarrierCallback(rawBody: string, hmacHeader: string | null): boolean;
```

`createHmac("sha256", API_SECRET).update(rawBody).digest("base64")`,
timing-safe compare. `API_SECRET` imported from `shopify.server`. Domain gate is
separate (route does the lookup): `rate.origin_shop_domain` must equal an installed
`Shop.shopDomain`.

## Task 4 — Public callback route (`app/routes/carrierrates.tsx`)

No `authenticate.admin`, no UI. `action` (POST only; everything else → 200 empty):

1. Read **raw** body text; `verifyCarrierCallback` fail → 200 empty.
2. Parse JSON; `rate.origin_shop_domain` → Shop lookup; missing/testMode → 200 empty.
3. Map payload → `CarrierCartContext` (items: grams, price cents→decimal, sku,
   vendor; subtotal = Σ price×qty; destination from `rate.destination`).
4. Deadline guard: capture `Date.now()` at entry; after Prisma load, if
   `elapsed > 1200ms` skip evaluation → empty (leaves response headroom under 1500).
5. Load enabled CARRIER_RATE rules + zones → `computeRates`.
6. Fire-and-forget `RequestLog` insert (source `CARRIER_CALLBACK`, input snapshot
   §A3, matched ids in order, rates, latencyMs) + 1-in-20 prune — `void` with
   `.catch(() => {})`.
7. Respond `{rates: [...]}` with `total_price` cents strings; `currency` = shop
   currency (label honestly, no FX).

Verify: integration tests — signed payload → computed rates; bad HMAC / unknown
domain / testMode shop → 200 + `{rates: []}` (criterion 3); injected delay → empty
(criterion 4); 60-line cart fixture under budget.

## Task 5 — Carrier GraphQL ops (`app/graphql/carrier.ts`)

`CREATE_CARRIER_SERVICE` / `LIST_CARRIER_SERVICES` / `DELETE_CARRIER_SERVICE` —
named exported constants. **Validate all three with the Shopify AI Toolkit
(`learn_shopify_api` → admin, then the GraphQL validator) before first use** — do
not trust assumed field shapes. Registration flow in
`app/services/carrier-registration.ts`:

```ts
export async function ensureCarrierService(admin, shopId): Promise<{ id, created }>;   // go-live; persists carrierServiceId
export async function removeCarrierService(admin, shopId): Promise<void>;              // tolerate already-deleted
export async function probeCcs(admin, shopId): Promise<"ELIGIBLE" | "CCS_OFF" | "ERROR">; // create+immediate delete; classify errors (§A3)
```

## Task 6 — Go-live UI (`app.settings.tsx` + `GoLiveCard.tsx`)

Settings section: registration status (LIST on load), Go-live button (gated:
testMode off + CCS_ELIGIBLE/ALL + wizard-consistent copy), Enter-test-mode button
(removes carrier service). `testMode` toggle must ALSO live here (moved/duplicated
from the dashboard card — single source in Settings, dashboard keeps status only).
Webhook `app/uninstalled`: add best-effort `removeCarrierService` (token may be
dead — catch).

Verify (criterion 5): go-live creates + persists GID; test-mode flip deletes;
Settings reflects state after manual deletion in admin (self-heal via LIST).

## Acceptance mapping

1–2 → Task 2 tests · 3–4 → Task 4 tests · 5 → Task 6 · 6 → Task 4 logging ·
7 → Task 2 currency cases · 8 → uninstall + post-uninstall callback (shop row
gone → empty).

## Do NOT

- Never respond non-200 from the callback (any error path → 200 empty).
- Never use floating-point for money; strings + `money.ts` only.
- Do not register carrier services for FUNCTIONS_ONLY shops (probe included).
- Do not add a `carrierSyncedAt` column (decided against — §A3).
