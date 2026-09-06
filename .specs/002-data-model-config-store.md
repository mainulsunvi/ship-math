# 002 — Data Model & Configuration Store

## 1. Problem statement

Every MVP feature — zones, rules, the Delivery Function, the carrier engine, the
simulator, AI-generated changes — needs a shared, typed configuration store. The
schema must support IF/THEN rules with AND/OR condition groups, priority ordering,
zone-to-postal-code targeting with four match modes, request logging for debugging,
and an audit trail that later backs AI rollback (spec 016). Getting this wrong
mid-build forces migrations on live shops; this spec fixes the shape up front.

## 2. Data model decision

**Prisma is the source of truth; a mirrored app-owned metafield on the
delivery customization *function owner* feeds the Delivery Function.** Functions run
in Shopify's sandbox — no network, no DB — so config must arrive through the input
query. Per Shopify docs the canonical carrier is a metafield **on the function owner**
(the `deliveryCustomization` object, NOT the shop: "input query variables do not
utilize metafields on the shop or app installation"). See `architecture.md` §A1.

- **Write path:** admin UI action → validate (Zod) → Prisma transaction → build
  compact function config (function-kind rules ONLY — HIDE/RENAME/MOVE, zones,
  testMode, evaluationMode) → `metafieldsSet` with `ownerId` = `Shop.functionOwnerId`.
  If the write fails, the action returns an error and the UI offers retry (Prisma row
  is committed, mirror marked stale via `functionSyncedAt`).
- **Read paths:** carrier endpoint + simulator + rules UI read Prisma directly; the
  Delivery Function (spec 006) reads the owner metafield only, live per checkout run.
- **Size budget (hard platform limit):** Shopify Functions receive `null` for
  metafield values > **10,000 bytes** even though JSON metafields store up to 128KB.
  Compact encoding (short keys, minified) with a **9,500-byte hard cap for the whole
  config** (amended 2026-09-05: the input-query cost cap of 30 leaves room for only
  ONE chunk slot alias `c1` on top of the primary + `input-variables` metafields, so
  chunking adds no capacity in MVP — see architecture.md §A1 constraint 7). One
  reserved string slot `function-configuration-1` is still written when the payload
  is too large for a single JSON value: the primary metafield then holds a manifest
  `{"v":1,"chunked":true,"parts":1}` and the Function parses the chunk string.
  Exceeding the cap raises typed `ConfigTooLargeError` — hard UI block with
  guidance — never a silent behavior change.

Models (SQLite-dev-compatible, Postgres-prod):

```prisma
model Shop {
  id             String   @id @default(cuid())
  shopDomain     String   @unique
  name           String?
  plan           String?
  isDevShop      Boolean  @default(false)
  testMode           Boolean  @default(true)
  evaluationMode     String   @default("FIRST_MATCH") // FIRST_MATCH | ALL_MATCH
  onboardedAt        DateTime?
  functionOwnerId    String?  // gid://shopify/DeliveryCustomization/… (owner of the config metafield)
  functionSyncedAt   DateTime? // null/old = mirror stale → banner + retry
  zones              Zone[]
  rules          ShippingRule[]
  requestLogs    RequestLog[]
  auditLogs      AuditLog[]
  aiUsage        AiUsageDay[]
}

model Zone {
  id          String   @id @default(cuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id], onDelete: Cascade)
  name        String
  enabled     Boolean  @default(true)
  countries   String   // JSON: string[] ISO-2, ["*"] = all
  provinces   String   // JSON: string[] codes, ["*"] = all
  postalRules String   // JSON: PostalRule[] (below)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model ShippingRule {
  id          String    @id @default(cuid())
  shopId      String
  shop        Shop      @relation(fields: [shopId], references: [id], onDelete: Cascade)
  name        String
  enabled     Boolean   @default(true)
  priority    Int       // lower runs first
  stopOnMatch Boolean   @default(false)
  kind        String    // CARRIER_RATE | HIDE | RENAME | MOVE (function rules use HIDE/RENAME/MOVE)
  zoneId      String?
  zone        Zone?     @relation(fields: [zoneId], references: [id], onDelete: SetNull)
  conditions  String    // JSON: ConditionGroup tree
  action      String    // JSON: typed per kind (rate params / new title / position)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}

model RequestLog {
  id          String   @id @default(cuid())
  shopId      String
  shop        Shop     @relation(fields: [shopId], references: [id], onDelete: Cascade)
  source      String   // CARRIER_CALLBACK | SIMULATION | FUNCTION_DEBUG
  inputDigest String   // hash of normalized cart+destination
  matched     String   // JSON: [{ ruleId, ruleName, order }]
  rates       String?  // JSON: returned rates
  latencyMs   Int?
  createdAt   DateTime @default(now())
  @@index([shopId, createdAt])
}

model AuditLog {
  id         String   @id @default(cuid())
  shopId     String
  shop       Shop     @relation(fields: [shopId], references: [id], onDelete: Cascade)
  actor      String   // MERCHANT | AI | SYSTEM
  summary    String
  changeSet  String   // JSON before/after snapshot
  createdAt  DateTime @default(now())
  @@index([shopId, createdAt])
}

model AiUsageDay {
  id        String   @id @default(cuid())
  shopId    String
  shop      Shop     @relation(fields: [shopId], references: [id], onDelete: Cascade)
  day       String   // YYYY-MM-DD
  requests  Int      @default(0)
  @@unique([shopId, day])
}
```

`PostalRule` (JSON inside `Zone.postalRules`): `{ id, mode: EXACT | PREFIX | RANGE | PARTIAL, value, rangeEnd? }`.
`ConditionGroup` (JSON inside `ShippingRule.conditions`): `{ combinator: AND | OR, conditions: Condition[] }`
where `Condition` is `{ field, operator, value }` over the MVP field set (subtotal,
weight, quantity, product tag, SKU, vendor, customer tag, logged-in, destination country/province/postal).

Storing conditions/zones as JSON columns (not normalized tables) keeps the condition
tree expressive and the migration surface small; they are always read whole-row and
never queried by inner field.

## 3. Admin GraphQL operations

- `SET_FUNCTION_METAFIELD` — `metafieldsSet` with `ownerId: <Shop.functionOwnerId>`,
  namespace `$app:delivery-customization`, key `function-configuration`, type `json`
  (matches the Function's scaffolded input query — the `$app:` prefix resolves to the
  app's owned namespace). One call per config-changing action; up to 4 calls when
  chunked (`function-configuration` + `function-configuration-1..3` as
  `single_line_text_field`). Est. cost: 1–4 per mutation, no loops.
- `GET_FUNCTION_METAFIELD` (verification only) — used by a "sync mirror" diagnostic
  button in Settings; also powers the byte-budget meter.

## 4. Access scopes required

### Amendment — schema v2 (2026-09-05, migration `20260905123305_carrier_prefs_log_input`)

Additive, back-compatible columns (all nullable):

- `Shop.carrierServiceId String?` — carrier service GID for the 007 registration
  lifecycle (mirrors `functionOwnerId`). Deliberately NO `carrierSyncedAt`:
  registration is binary and cannot drift; Settings verifies via
  `LIST_CARRIER_SERVICES` (architecture.md §A3).
- `Shop.prefs String?` — JSON for UI-dismissal state only (plan banner, checklist
  hints — specs 003/010, architecture.md §A5). Never domain state.
- `RequestLog.input String?` — bounded JSON input snapshot (destination, subtotal,
  weight, quantity, currency) powering the simulator trace and the 018 debugging
  substrate; no customer PII beyond destination.
- `RequestLog @@index([shopId, source, createdAt])` — the log viewer's source
  filter (spec 008).

No change beyond 001 (`read_products, read_shipping, write_shipping`). App-owned
metafields require no extra scope.

## 5. Webhook topics consumed

None new. `app/uninstalled` cascade (001) now also destroys zones/rules/logs — proven by criteria below.

## 6. File-by-file change list

- `prisma/schema.prisma` — models above; relation from `Shop` (001).
- `prisma/migrations/*` — one migration.
- `app/lib/config-schema.ts` — Zod schemas: `PostalRule`, `Condition`, `ConditionGroup`, `RateAction`, `FunctionConfig` (compact/wire format) + `validateFunctionConfig()` declaration.
- `app/lib/function-config.ts` — `buildFunctionConfig(shopId)` (Prisma → compact JSON, function-kind rules only, budget check + chunking) and `pushFunctionConfig(shopId)` (metafieldsSet on owner) as function declarations.
- `app/db.server.ts` — repository functions: `listRules`, `getRule`, `createRule`, `updateRule`, `deleteRule`, `duplicateRule`, `reorderRules`, and zone equivalents.
- `app/graphql/metafields.ts` — `SET_FUNCTION_METAFIELD`, `GET_FUNCTION_METAFIELD` (parameterized by `ownerId`).

## 7. Acceptance criteria

1. `prisma migrate dev` applies cleanly on a database seeded with a `Shop` row from 001.
2. Creating a rule with an invalid condition tree (bad operator) returns a typed error and writes nothing.
3. After any rule/zone mutation, `pushFunctionConfig()` produces a `metafieldsSet` call whose payload validates against `FunctionConfig` (verified by reading the metafield back in a test), and every written value is ≤ 9,500 bytes.
4. A payload exceeding the primary slot is written as manifest + chunk: the Function's guarded parse of `{"v":1,"chunked":true}` reading the `c1` string yields the same WireConfig as the unchunked form (fixture `chunked.json`, extension test suite).
5. Config exceeding the 9,500-byte cap raises a typed `ConfigTooLargeError` from the action, writes NO partial mirror, and the UI blocks with guidance.
6. Deleting a shop cascades all five child tables (asserted in a test with seeded children).
7. `duplicateRule` copies conditions/action, appends " (copy)", places the duplicate adjacent in priority, and bumps priorities below it.
8. 200 function rules × 20 postal rules per zone round-trips through `buildFunctionConfig()` under 500ms on dev hardware.
9. Mirror-stale state (`functionSyncedAt` older than last rule `updatedAt`) is surfaced as a banner flag in the settings loader (wired in 008/010).

## 8. Open questions

1. Postgres cutover date (carried from 001) — JSON columns are fine on both engines; no schema change needed, only `datasource` block.
2. Should `RequestLog` live in a separate cold database at scale? Defer to spec 019; single DB for MVP.

## Standard scenarios

- **Uninstall → reinstall:** cascade delete removes all config; reinstall starts empty and the wizard (003) reruns.
- **Plan downgrade:** rows are not tier-limited in MVP; nothing to trim. (Revisit when tiers exist — see 016/019.)
- **Partial webhook failure/retry:** no new webhooks; `app/uninstalled` retry re-deletes idempotently.
- **Large catalog:** config is shop-authored (zones/rules), not catalog-derived — size is bounded by merchant config volume, not catalog size. Criterion 6 sets the perf bar; a soft cap of 500 rules with a UI warning is enforced in the rules loader (005).
