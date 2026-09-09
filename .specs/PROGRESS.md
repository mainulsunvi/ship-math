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

## 004/005 execution — Orchestrator run 2026-09-06

- ✅ Backend agent (plan 004-005 Tasks 1+3): `app/lib/postal.ts`
  (validatePartialPattern UK/CA, formatForDisplay), `app/lib/repositories/rules.ts`
  (full rule/zone repo set, no mirror calls inside), `StoredRuleSchema` + §A3
  lane-capability refine in `config-schema.ts`, `app/lib/carrier/action-schema.ts`,
  root vitest 4.1.11 + sqlite fixture DB (`SHIPMATH_TEST_DATABASE_URL`), 4 test
  files / 51 tests. Gate A: `tsc --noEmit` clean, `pnpm test` 51/51.
- ✅ Frontend agent (Tasks 2+4+5): `app/routes/app.zones.tsx` + ZoneEditorModal +
  PostalRuleEditor (PARTIAL UK/CA-only w/ server backstop), dashboard rework
  (SyncStatusCard, RulesTable, toolbar, evaluation-mode Select, ≥400 cap banner),
  rule editor stack (RuleEditorModal, recursive ConditionGroupEditor depth≤3,
  ConditionRow w/ §A3 field hiding + tooltip, ActionEditor incl. CARRIER_RATE
  form, string money), SettingToggle, audit helper (`writeAudit` fail-open),
  `syncMirror` wrapper (mirror errors → stale banner + retry, never throw).
- 🐞→✅ Tester verification: criteria matrices for 004/005 + 78 new unit-test
  cases (zone-matching table, rule-evaluation ordering, purity guard, audit,
  shop lifecycle). Found HIGH bug: wildcard `["*"]` province rejected missing
  province → **fixed** in `zone-matching.ts` (wildcard checked before missing-
  value guard; extension rebuilt). Found MEDIUM-HIGH silent truncation →
  `variablesTruncated`/`excluded` now carried through `MirrorSyncReport` and
  rendered as dismissible warning banners (`SyncReportWarnings`).
- ✅ collectTags fix: tag-list (`in`/`not_in`) string[] values now flatten into
  input variables (dedupe, 100/list cap, deterministic order) — previously
  array tags silently never reached the Function. Pure helper in
  `app/lib/tag-collection.ts`; 12 tests.
- ✅ Reviewer verdict `.specs/reviews/004-005-review.md`: initial CHANGES
  REQUESTED (1 REQUIRED + 3 should-fix) → **re-verified APPROVED** (2026-09-06).
  All resolved: sync failure-path tests via vi.mock admin stub (4 cases,
  MirrorSyncReport shape pinned), shared `app/lib/budget.ts` (SOFT_CAP_BYTES),
  `validatePostalRuleForCountries` + `parseCodeArray` moved to
  `app/lib/postal.ts` (component-import boundary removed), evaluation-mode
  **Behavior** column added to RulesTable, dead re-export + one import-depth
  fix applied by orchestrator (mechanical).
- ✅ Gates final: `tsc --noEmit` clean · root vitest 11 files / 133 tests green ·
  vite build clean · extension `Function built successfully` (post-fix) +
  8/8 fixtures green.
- ✅ Open question RESOLVED (2026-09-06, human decision "go with helper decision"):
  spec 004 criterion 6 amended — `findMatchingZones(zones: WireZone[], destination:
  Destination): WireZone[]` pure input-order filter in `zone-matching.ts`; NO
  zone-priority column/migration (rule priority in 005 is the only ordering
  semantic). Spec §2/§6 reconciled; architecture.md §A4 decision bullet added.
  Gates: tsc 0 · root vitest 11 files / **140** tests (+7) · vite build 0 ·
  extension rebuilt + 8/8 fixtures. Review file §"Criterion 6 resolution" —
  verdict APPROVED, no open items. 004/005 lane COMPLETE pending human manual
  test (script in review file §manual).
- ⬜ Manual smoke (dev server) pending — HUMAN will run manually after coding
  phase; script in review file §manual: wizard flows, mirror-failure retry
  banner, ≥400 cap banner, US+PARTIAL rejection, UK wildcard regression.

---

## UI design upgrade — Orchestrator run 2026-09-06 (direction: branded accents, scope: everything)

- ✅ Frontend Pass 1 (foundation): `app/styles/brand.css` (accent tokens
  `--sm-accent` #4f46e5 family + dark-scheme overrides + `.sm-accent-dot`;
  single place to rebrand), `ShipMathPage.tsx` shared page shell, ShipMathNav
  rewritten (brand row + borderless Tabs, exact-match highlighting — fixed
  greedy "/app" match bug, dead `quantible-custom-max-width` class removed),
  NavMenu fixed to Dashboard/Zones/Settings, `/app/additional` now a
  redirect-only stub (bookmark-safe, scaffold gone).
- ✅ Frontend Pass 2 (surfaces): dashboard + zones + settings wrapped in
  ShipMathPage with proper titles/subtitles/primary actions; new shared
  `KindChip`/`AccentChip`/`ModalSection` components (reuse ×2 each);
  RulesTable kind badges → KindChip; both editor modals sectioned (Basics /
  IF / THEN and Identity / Targeting / Postal rules); postal preview as accent
  chip; settings rewritten (scaffold copy gone, SettingsPage). ZERO logic
  changes — all intents/fetchers/banners/pagination/validation verified intact
  by review.
- ✅ Review `.specs/reviews/design-2026-09-06.md`: CHANGES REQUESTED → all
  three findings fixed (arrow→declaration in nav; dark-scheme accent tokens;
  empty loader/action stubs removed from settings). Gates final: tsc 0 ·
  vitest 140/140 · vite build clean. Verdict expected APPROVED on re-review.
- Note: rebrand = edit tokens in `app/styles/brand.css` only.

---

## Switch rollout — Orchestrator run 2026-09-06 (user directive: every toggle = switch)

- ✅ Frontend: NEW `app/components/ui/Switch.tsx` (accessible paddle switch:
  button role="switch" + aria-checked + focus ring + keyboard via native
  button; Polaris 12 has no Switch export — custom, styled with Polaris tokens
  + `--sm-accent` in brand.css). `SettingToggle` wrapper reworked (Checkbox →
  Switch; props contract unchanged → all call sites untouched). ALL 8 boolean
  Checkbox usages converted: RulesTable + zones-table enabled columns,
  SettingToggle interior, ActionEditor (Open-ended / Charge per item / Charge
  per weight), ZoneEditorModal (Ship to every country / Any province).
  Handlers byte-identical — control swap only, zero logic drift (verified by
  review). Gates: tsc 0 · vitest 140/140 · vite build clean. Review appended
  to design-2026-09-06.md → APPROVED for the Switch change.
- ✅ Convention recorded in docs/INSTRUCTION.md (UI/UX section): boolean
  toggles always use `app/components/ui/Switch.tsx`.

---

## Rules on routes + public uid — Orchestrator run 2026-09-07 (user decision)

- ✅ Backend (agent): `ShippingRule.uid String? @unique` + migration
  `20260906184713_rule_uid` (with randomblob backfill for pre-existing rows);
  `generateRuleUid()` 10-char base36 in `repositories/rules.ts`; `createRule`/
  `duplicateRule` mint fresh uids (P2002 retry ×3); NEW `getRuleByUid(shopId,
  uid)` (cross-shop → null); `updateRule` ignores smuggled uid changes; 5 new
  tests. Prisma client regenerated.
- ✅ Frontend (orchestrator-implemented — GLM subagent rate-limited): NEW
  `app/components/rules/RuleForm.tsx` (modal's form logic verbatim; Card
  sections Basics / IF / THEN; create+edit in one component), NEW
  `app/routes/app.rules.new.tsx` (rule-create orchestration verbatim), NEW
  `app/routes/app.rules.$uid.edit.tsx` (loader via getRuleByUid → 404 on
  miss/foreign uid; rule-update orchestration; "ID: <uid>" shown on page);
  dashboard rewired (New rule → route, onEdit → `/app/rules/<uid>/edit`,
  modal state removed, RuleRow carries uid); `RuleEditorModal.tsx` DELETED;
  ShipMathPage gained backAction passthrough. Gates: tsc 0 · vitest 145/145 ·
  vite build clean.
- ✅ Convention recorded in docs/INSTRUCTION.md: rules are route-based
  (exception to modals-over-routes); zones/other flows stay modal.
- Reviewer pass pending (rate-limited session) — flag for next orchestrator
  run to append verdict.

## Help center docs — Orchestrator run 2026-09-07 (user directive)

- ✅ Investigation: documentation agent had never been dispatched and its old
  output contract pointed at unbuilt artifacts (spec 010 surfaces, spec 016
  CSV schema) — nothing to write yet. Also fixed stale `GLM-4.7 (zai)` model
  names in `documentation.agent.md` that would have silently fallen back.
- ✅ NEW `docs/help/` user-facing help center (7 pages): README index,
  getting-started, zones, rules, sync, test-mode, faq. All follow the six
  binding style rules (you/your POV, SCREENSHOT placeholders, Video tutorial
  section, how-to style, docs-ship-with-code, plain English). Content
  verified against routes/components (labels: "New rule", "Sync now", "Sync
  config to checkout", "Add sample rules", "Turn on test mode"/"Go live",
  kinds HIDE/RENAME/MOVE/CARRIER_RATE, 50/page, 9,500-byte budget).
- ✅ `documentation.agent.md` updated: docs/help/ ownership, six style rules
  (binding), output contract enforces them, model names fixed.
- ✅ `docs/INSTRUCTION.md` gained a Documentation section with the six rules.
- ✅ Revision (same day, user feedback): help docs rewritten for
  non-technical readers; placeholders are now VISIBLE `[Add ... Screenshot]` /
  `[Add ... Video Tutorial]` markers (HTML comments were invisible when
  rendered); rules grew to eight binding items (no "we/us/our", no em-dashes
  in help content); documentation.agent.md model names re-fixed to plain GLM
  ids after they reverted.
- Standing duty for every future run: code changed → update affected
  `docs/help/` pages in the same run.
- ✅ Revision (2026-09-07, user feedback): full readability pass over
  `docs/help/` — test-mode intro rewritten plainly (one switch, it is in
  Settings), Go-live section rewritten to match the Switch UI (old button
  labels no longer exist), README Settings row corrected (was still
  "next release"), jargon replaced ("no operations", "event notification",
  "master copy", "carrier callback", "shrinks your allowance"), nested-group
  example made concrete (VIP tag instead of the confusing metro/weight one),
  idioms removed ("where you stand", "keep it out of the red", "comes back").
- ✅ Revision (2026-09-07, user request): NEW "How to use test mode, step by
  step" section in test-mode.md (turn switch on → build rules → check work →
  back to live with unpaid test-order instructions + 3 new screenshot
  placeholders); replaced the thin "safe testing workflow" list, which also
  referenced the not-yet-built simulator (doc accuracy bug) — the walkthrough
  now uses honest checks (read rules back, verify priorities) until spec 008
  ships the simulator, at which point Step 3 should be updated.
- ✅ Revision (2026-09-07, user directive): all 7 `docs/help/` pages rewritten
  in the future tense with a natural human voice ("Click **Zones** and a form
  will open..."). Removed AI-sounding patterns ("The good news:", formulaic
  bold-lead bullet lists, perfectly parallel sentences). The style rule was
  added to the binding documentation rules in `docs/INSTRUCTION.md` (rule 6)
  and `.github/agents/documentation.agent.md` (style rule 6) so every future
  doc run writes the same way. Docs-only change; no gates required.

---

## 007 — Carrier service rate engine — Orchestrator run 2026-09-07

- ✅ Backend (plan 007 Tasks 2–5): `app/lib/money.ts` (pure decimal-string
  math: add/multiply/compare/clamp + `toCentsString` round half-up — zero
  Number() on money), `app/lib/carrier/engine.ts` (pure `computeRates`:
  priority sort, zone fail-closed, FIRST_MATCH/ALL_MATCH/stopOnMatch,
  flat/free/tiered/percentage pipeline + perItem/perWeight/handlingFee/cap,
  weight tiers in kg bands `[from, to)` last open), `app/lib/carrier/verify.ts`
  (timing-safe HMAC-SHA256 base64 over raw body, fail-closed on empty secret),
  `app/routes/carrierrates.tsx` (public POST callback: ALWAYS 200, `{rates:[]}`
  fail-open on every gate; 1200ms budget guard; fire-and-forget RequestLog
  `CARRIER_CALLBACK` + ~1-in-20 30-day prune; response rates use SUBUNIT
  STRINGS per Shopify docs, description always present), `app/graphql/carrier.ts`
  (CREATE/DELETE/LIST ops; shapes verified against shopify.dev examples — the
  toolkit GraphQL validator tool was not exposed in this session, disclosed),
  `app/services/carrier-registration.ts` (`ensureCarrierService` create+persist
  GID with LIST self-heal, `removeCarrierService` tolerate already-deleted/dead
  token and always clear GID, `probeCcs` create+immediate-delete →
  ELIGIBLE/CCS_OFF/ERROR, `findCarrierService` for the settings loader).
- ✅ Uninstall webhook: best-effort `removeCarrierService` (catches dead token).
- ✅ Shared converter extraction: `buildWireZones` + exported
  `toWireConditionGroup` in `function-config.ts` now serve BOTH lanes (§A4
  no-drift rule); wire maps typed with `WireConditionField`/`WireOperator`,
  postal wire uses `WirePostalRule`.
- ✅ Frontend (Task 6): NEW `app/components/settings/GoLiveCard.tsx` (status
  badge, scope-error + remotely-deleted banners, Go live / Enter-test-mode
  buttons, test mode as app-standard Switch via SettingToggle); `app.settings.tsx`
  rewritten (loader does LIST status check, intents toggle-test-mode (with
  Function sync — config embeds `t`), enter-test-mode (sync + teardown),
  go-live (gate testMode off → probe → ensure)); dashboard SyncStatusCard and
  Environment card now test-mode STATUS only; dashboard `testMode` intent
  removed — Settings is the single source (INSTRUCTION.md switch convention
  honored). `getOrCreateShop` now returns `carrierServiceId`.
- ✅ Tests: money 29 · engine 20 · route integration 11 (signed→rates, bad
  HMAC/unknown domain/testMode/disabled-zone/malformed JSON → 200 empty,
  Date.now-shifted latency-guard trip, 60-line cart through weight tiers,
  RequestLog written, FIRST_MATCH vs ALL_MATCH) · purity guard +2 entries
  (money, carrier/engine). vitest env gained stub SHOPIFY_* vars so route
  tests may import shopify.server (test-only, mirrors SHIPMATH_TEST_DATABASE_URL
  pattern).
- ✅ Gates final: `tsc --noEmit` clean · root vitest 14 files / **209** tests ·
  extension 8/8 (note: default 45s hook timeout trips on cold wasm build —
  run `vitest run --hookTimeout 300000` in the extension) · vite build clean.
- ✅ Docs shipped with code: test-mode.md (Settings location, new "Going live
  with carrier rates" section), rules.md (live gate note), getting-started.md
  (4th troubleshooting suspect), README.md index line.
- 📊 LOC (this run, per git numstat + untracked counts): 2,055 lines added /
  77 deleted across 19 files — production ~1,391, tests ~649, config 15.
  New files: GoLiveCard 126, graphql/carrier 51, engine 248, verify 27,
  money 164, carrierrates 246, carrier-registration 223, money.test 94,
  carrier-engine.test 283, carrierrates-route.test 264.
- ⚠️ Operator notes: scopes commit `6ae3fe5` landed BEFORE the no-commit
  directive; nothing committed since. Dev store will prompt re-auth on next
  `shopify app dev` (read_shipping/write_shipping scopes). Manual smoke
  pending (human): go-live creates "ShipMath" carrier service, callback in
  checkout, enter-test-mode teardown, uninstall cleanup.
- Reviewer verdict pending (user will trigger; 004-005 review also still open).

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

## 003 — Setup wizard — ✅ (Orchestrator run 2026-09-09, detail below)

## 004 — Zone & postal targeting — 🔄 (matching engine done + fixture-tested;
UI editor designed — `plans/004-005-plan.md`)

## 005 — Rule builder UX — 📐 plan ready (seed action + status page shipped)

## 007 — Carrier service engine — ✅ (run 2026-09-07, see section above)

## 008 — Test-mode simulator & log — ✅ (Orchestrator run 2026-09-07, detail below)

## 009 — AI assistant — 📐 plan ready (needs env keys before coding)

## 010 — Review kit — 📐 plan ready (needs hosting URL before final docs)

---

## 008 execution — Test mode, rate simulator & request log — 2026-09-07

- ✅ `app/lib/rule-explain.ts` — pure explain traces: `explainConditionFailure`
  (exact leaf path, e.g. `c.n[1].n[0]`, through the SHARED evaluator — no
  re-implementation), `explainRules` (every rule reported, zone gates incl.
  fail-closed `missing-zone`), `traceCarrierRules` one-call wrapper.
- ✅ `app/lib/carrier/engine.ts` — `computeRatesDetailed` IS the production
  loop (`computeRates` is now a thin `.rates` projection — parity by
  construction); tier-no-match continues the pipeline (`producedRate: false`,
  never short-circuits); `toCartFacts` exported.
- ✅ `app/lib/simulate.ts` — `simulateRun(shopDomain, input)`: Function lane via
  `buildFunctionConfig` + `explainRules` (ConfigTooLargeError → `note` +
  `wireBytes`, carrier lane still runs), Carrier lane identical to the
  callback route; zod `SimInputSchema`; writes one SIMULATION RequestLog row
  (matched tagged `lane: FUNCTION|CARRIER`) + `parseSimPayload` shared by both
  routes that host the modal.
- ✅ `app/lib/function-config.ts` — `BuiltFunctionConfig.mirrored`
  (wireId → Prisma ruleId) so simulator traces carry real rule names with no
  order-duplication drift.
- ✅ `app/lib/prune-logs.ts` — `pruneIfDue` (1-in-20), `pruneRequestLogs`
  (30-day, per-shop), `inputDigestFor`; carrierrates route now uses the
  shared helpers (behavior unchanged).
- ✅ Simulator UI — `app/components/simulator/` (CartBuilder, DestinationForm,
  TraceResult, SimulatorModal); `app._index` button ENABLED + `simulate`
  intent; `app.logs.tsx` (50/page, ?source filter, expandable rows, same
  modal); nav **Logs** tab (ChartCohortIcon).
- ✅ Tests +18 (231 total root): rule-explain 10, simulate 7 (byte-identical
  parity vs `computeRates`, ALL_MATCH winner traces, zone gate naming,
  over-budget degradation, SIMULATION row shape, test-mode independence),
  prune 4 (idempotent sweep, deterministic cadence, digest stability),
  purity-guard entry for `rule-explain.ts`.
- ✅ Docs (future tense, same run): NEW `docs/help/logs.md`; test-mode.md
  Step 3 leads with the simulator; rules.md "Preview with the simulator";
  help README table rows (Rules, Logs) + guide link.
- ✅ Gates: `tsc --noEmit` 0 · root vitest 17 files / **231** tests green ·
  extension 8/8 fixtures green (hookTimeout 300s) · `pnpm run build` clean.
- LOC: ~2,550 added (12 new files ≈2,334 incl. help page + 9 modified, +212/−52).
- ⬜ Manual smoke pending — HUMAN: run simulator from dashboard + logs page,
  confirm SIMULATION rows appear in Logs, filter works, prune does not eat
  fresh rows.

### 008 addendum — simulator page (2026-09-08)

- ✅ Simulator promoted from modal to full route `app/routes/app.simulator.tsx`;
  Dashboard "Simulate rates" + Logs page now deep-link to it; simulator nav tab
  (PriceListFilledIcon) + NavMenu link added.
- ✅ Pickers: products via `shopify.resourcePicker` (App Bridge v4 API — the old
  `ResourcePicker` component is gone from `@shopify/app-bridge-react`) with real
  prices/weights/SKUs + editable rows (custom lines still available); full
  checkout-style `AddressForm` (26 countries, US/CA province selects); pickup
  locations + customers (3 dummy testers + real customers w/ tags) via new
  `app/graphql/directory.ts` (scopes `read_customers`, `read_locations` added);
  Shopify shipping zones via direct REST `shipping_zones.json` fetch (session
  token; `admin.rest` does not exist in this AdminApiContext) used as a
  destination-country shortcut.
- ✅ Combined-rules picker: `onlyRuleIds` in `SimInputSchema` — Function lane
  filters `built.mirrored` → wire ids before `r` filtering; carrier lane
  `where id in`; empty/absent = all rules (test "onlyRuleIds scopes the run").
- ✅ `CheckoutSummary` (checkout-style order summary: ship-to, line items with
  images, items/weight/subtotal, shipping-rate radios, shipping + total) +
  TraceResult in a sticky right column.
- ✅ Dead code removed: SimulatorModal, CartBuilder, DestinationForm deleted;
  TraceResult kept.
- ✅ Docs: NEW `docs/help/simulator.md` (full page guide); rules.md simulator
  section + test-mode.md Step 3 + help README (guide link + Simulator table row)
  point at the page.
- ✅ Gates: `tsc --noEmit` 0 · root vitest **232** green (+1 onlyRuleIds) ·
  extension 8/8 · `pnpm run build` clean.
- LOC: ~1,600 added (5 new files 1,594: app.simulator.tsx 937, AddressForm 255,
  CheckoutSummary 265, directory.ts 38, simulator.md 99; index/logs strip-down
  offsets part of it in modified files).

### 008 addendum 2 — store shipping methods in the summary (2026-09-08)

- ✅ Shopify's own rates (price/weight-based, e.g. Standard free / Express $15)
  now appear in the summary's rates box: `app/lib/store-rates.ts` parses REST
  `shipping_zones.json` (shared fetch with the zone picker), filters by
  destination/subtotal/weight (bounds inclusive, province-restricted zones
  honored), applies Function-lane HIDE/RENAME/MOVE via the SHARED
  `optionMatchesTarget` (parity by construction), then appends carrier rates
  and applies MOVEs over the combined list (clamped like the Function).
- ✅ Page: loader returns `storeRates`; address defaults to the first store
  zone's country; CheckoutSummary renders `CheckoutOption[]` with store/rule
  source labels and stale-selection fallback; fixed `&&`-vs-`||` id-guard bug
  in the zone-option builder.
- ✅ Tests +15 (**247** total root): parsing (malformed skipped), country/
  province/subtotal/weight filtering, HIDE (targeted, catch-all, methodType
  PICK_UP ignored), RENAME, MOVE (combined list, clamped, priority order).
- ✅ Docs: simulator.md order-summary section documents store methods, zone
  gating, and the Markets caveat. Gates: tsc 0 · 247 green · build clean.

### 008 addendum 3 — store rates via GraphQL + customization report (2026-09-08)

- ✅ Root cause of "No shipping options": the REST fetch pinned
  `/admin/api/2026-10/` (not a real version) → 404 → zones AND store rates
  silently empty. Replaced with `DELIVERY_PROFILES_QUERY` in directory.ts
  via `admin.graphql` (app-pinned version; no manual version string).
  Schema-validated against 2025-10 (the effective runtime version — the
  app's January25 pin auto-upgrades): `code` is an OBJECT {countryCode,
  restOfWorld} there (union only in 2026+), and methodDefinitions hang off
  locationGroupZones, NOT the zone.
- ✅ store-rates.ts rewritten for the GraphQL shape: methodDefinitions with
  rateProvider DeliveryRateDefinition static prices (carrier participants
  skipped), methodConditions TOTAL_PRICE/TOTAL_WEIGHT (MoneyV2/Weight
  criteria; units converted to grams), provinces on DeliveryCountry,
  rest-of-world zones cover any country, method ids de-duplicated across
  profiles. Bonus: Markets-based shipping IS covered (delivery profiles).
- ✅ buildCheckoutOptions → CheckoutPreview {options, customizations,
  unmatchedOps}: ONE combined store+carrier list, ops applied in priority
  order through the shared optionMatchesTarget; every hide/rename/move
  recorded (old+new title, final position).
- ✅ UI: "Delivery customizations" list under the rates box in the summary
  ("\"Express\" hidden by rule \"No express\"", …, moved → 1-based position);
  subdued note when ops ran but matched nothing (unmatchedOps).
- ✅ Tests +4 net (**251** total root, 19 in store-rates): GraphQL fixtures,
  ROW/province zones, pounds/kilograms bounds, ops-across-both-sources
  (rename reaches carrier rates), priority order, unmatched counting.
- ✅ Gates: tsc 0 · 251 green · build clean. Extension untouched.

### 008 addendum 4 — "still no shipping methods" diagnostics (2026-09-08)

- ✅ Root causes addressed: (1) app pinned `ApiVersion.January25` ("2025-01",
  EXPIRED Jan 2026) — every admin.graphql call was at Shopify's mercy for
  unsupported versions; bumped to `ApiVersion.January26` (installed
  shopify-api 13.1.0 enum max; DELIVERY_PROFILES_QUERY re-validated against
  2026-01 — same `code {countryCode restOfWorld}` object shape as 2025-10).
  (2) New scopes (`read_shipping` etc., added to toml earlier this session)
  only take effect after the store RE-AUTHORIZES — stale token = silent
  empty lists.
- ✅ No more silent failure: fetchDeliveryZones returns `error` (HTTP status,
  GraphQL error messages, or exception) → loader `storeRatesError` → warning
  Banner on the simulator page with the actual message + reinstall/dev
  guidance. Rule-based rates unaffected either way.
- ✅ Gates: tsc 0 · 251 green · build clean.
- ⬜ HUMAN: rerun `shopify app dev` (accept the scope update prompt), reload
  Simulator — Standard/Express should list as "store"; if not, the banner
  now names the exact reason.

### 008 addendum 5 — query-cost pagination (2026-09-08)

- ✅ The banner surfaced the real blocker: the single deliveryProfiles query
  cost **1527 points** (Shopify single-query limit: 1000) — nested firsts
  20/50/100 multiply. Fixed: DELIVERY_PROFILES_QUERY now takes `$after` and
  pages **2 profiles per request** with capped inner lists (20 zones, 20
  methods), re-validated against 2026-01; fetchDeliveryZones loops pageInfo
  (≤ 8 pages → 16 profiles) and keeps the error surfacing. Per-request cost
  is far under the limit; total coverage unchanged for realistic stores.
- ✅ Gates: tsc 0 · 251 green · build clean.

### 008 addendum 6 — sticky order summary fix (2026-09-08)

- ✅ Root cause: Polaris 12.27 Layout renders `align-items: flex-start` —
  each `Layout.Section` collapses to its OWN content height, so the sticky
  right column had zero travel room inside its parent and position:sticky
  silently did nothing. Replaced the page's Layout with a custom flex row
  (`align-items: stretch`, wrap, gap 1rem, bases 30rem/24rem) — columns now
  stretch to row height and the sticky summary engages. Verified body and
  .Polaris-Page set no overflow (no scroll-container culprit); Polaris
  itself uses position:sticky 13× in its bundle.
- ✅ Gates: tsc 0 · build clean (UI-only change; 251 tests untouched).

---

## 003 execution — Setup wizard & plan guidance — 2026-09-09

- ✅ Backend (plan Tasks 1–2): `app/lib/plan.ts` (pure classifier FUNCTIONS_ONLY /
  CCS_ELIGIBLE / ALL via displayName heuristics + dev/Plus flags, unknown-default
  CCS_ELIGIBLE; PLAN_CLASS_LABELS; planClassFromShop; shouldShowPlanBanner keyed to
  current class so a plan change reappears the banner) + `app/graphql/shop.ts`
  SHOP_DETAILS; `webhooks.app.shop-update.tsx` (idempotent plan/name upsert, retry-safe)
  + toml subscription; `app/services/shop-details.ts` ensureShopPlanDetails (one-time
  GraphQL backfill, never throws into a loader); db.server gained ShopPrefs/updatePrefs
  (null CLEARS a key)/readPrefs/saveShopPlanDetails + appendWizardDraftId /
  readWizardDraftIds; getOrCreateShop now returns the full Shop type.
- ✅ Route side: `app/lib/zone-form.ts` (parseZoneForm extracted verbatim from the zones
  route) + StoredRuleSchema optional `enabled` flag (createRule honors; updateRule
  ignores — RuleInput now z.input so the default is input-optional); app._index gained
  wizard-zone-create / wizard-rule-create (drafts forced `enabled: false`, ids recorded
  in prefs, audited, NO sync) + wizard-complete (flips EXACTLY prefs-recorded drafts →
  onboardedAt → one syncAfterOwnerEnsure push → optional carrier registration gated on
  planClass ≠ FUNCTIONS_ONLY via probeCcs, CCS_OFF/ERROR = informational note only;
  commit-before-push ordering: sync failure keeps drafts enabled + onboardedAt set);
  loader returns shopName/planClass/onboardedAt/zones.enabled + first-load plan backfill.
- ✅ Frontend: PlanBanner (info tone on FUNCTIONS_ONLY with carrierRegistered-aware
  downgrade copy; warning on CCS_ELIGIBLE with Shopify CCS help-doc link + Settings Go
  live pointer; dismissal posts to dedicated action-only route `app.prefs.tsx` — leaf
  actions 400 on unknown intents so layout-action bubbling was unreliable); SetupWizard
  modal on the dashboard gated by onboardedAt === null with local latch (success banner
  survives revalidation): Welcome / Your Plan / Delivery Zones (stacked ZoneEditorModal
  with new `draft` prop → wizard-zone-create + "Draft zones turn on when you finish
  setup") / Rate Rules ("Set Up With AI" placeholder card + embedded RuleForm →
  wizard-rule-create, declining AI never blocks) / Carrier Rates (CCS plans only,
  SettingToggle+Switch "Register carrier rates" → carrier=1) / Test Mode / Finish Setup
  (SyncReportWarnings + critical banner on sync failure); Settings gained a Setup card
  with "Restart setup" (clears onboardedAt + draft lists, redirects to /app).
- ✅ Tests +41 → **329** root (23 files): plan matrix (existing 25), zone-form 14,
  shop-update webhook 4 (authenticate.webhook mock pattern lifted), db-prefs (merge
  semantics, idempotency, corrupt JSON, ensureShopPlanDetails never-throws),
  wizard-intents 16 (draft semantics, commit-before-push, probe test-doubles incl.
  Basic-plan NEVER probed, empty-config ≤ byte cap, 55-rule pagination, uninstall
  cascade), repo enabled-flag + smuggle-pins, purity-guard + plan.ts + zone-form.ts.
- ✅ Reviewer (2 verdicts, both → APPROVED after fixes):
  - `003-review.md` — REQUIRED (wizard-complete blanket flip would re-enable
    deliberately-disabled rows on Restart setup) → FIXED via prefs draft-id scoping +
    regression test; SHOULDs fixed (CCS doc link, downgrade banner copy, HelpTooltip
    `paddingTop: "5\t px"` tab-corrupt CSS); spec reinstall scenario amended to match
    shipped data-survival behavior.
  - `005-rules-on-routes-review.md` (PENDING from 2026-09-07 rate-limited session) —
    REQUIRED (`/app/rules` nav link 404: no index route) → FIXED via
    `app.rules._index.tsx` redirect; SHOULDs fixed (dead rule-create/rule-update intents
    removed from app._index; parseRuleForm extracted to shared `app/lib/rule-form.ts`,
    3 copies → 1); ShipMathNav items skipped per user-owned-file directive.
- ✅ Docs (same run, 8 binding rules): getting-started.md REWRITTEN around the wizard
  walkthrough (7 steps, drafts-off-until-Finish, Skip for now, Restart setup, plan
  banner; 10 screenshot placeholders); README index rows; FAQ +2 entries (rerun wizard,
  plan banner); zones.md draft-mode pointer; simulator.md em-dash fix.
- ✅ Gates final: `tsc --noEmit` 0 · root vitest 23 files / **329** tests · extension
  8/8 (first cold-build run flakes on wasm compile; rerun clean — known) ·
  `pnpm run build` clean.
- 📊 LOC (uncommitted, per git status): ~2,900 added across 30+ files — production
  ~1,800 (plan/shop-details/webhook/prefs helpers/wizard intents + SetupWizard 7 steps
  + PlanBanner + prefs route + rules redirect + rule-form extraction), tests ~800,
  docs/spec/reviews ~300.
- ⚠️ Operator notes: GLM provider flaked twice (orchestrator run truncated mid-Task-1 →
  work continued via direct Backend/Frontend dispatches, then direct implementation for
  review fixes); nothing committed (user commits manually). `shopify.app.toml` gained the
  shop/update subscription → dev store may prompt on next `shopify app dev`.
- ⬜ Manual smoke pending — HUMAN: fresh-install wizard flow (drafts disabled → Finish
  → enabled + synced), Skip-for-now abandonment (drafts stay disabled, wizard reopens),
  Restart-setup rerun with a deliberately-disabled rule (MUST stay disabled — the
  review's REQUIRED regression), plan banner dismiss + plan-change reappear, `/app/rules`
  nav click lands on dashboard, carrier step absent on Basic dev-store plan.

### 003 addendum — wizard visual redesign (2026-09-10, user: "looks so basic")

- ✅ Direction chosen by user: **polished modal** (keep large modal + auto-open semantics;
  full-screen takeover and a dedicated /app/setup route were offered and declined).
- ✅ NEW `WizardProgress.tsx`: numbered-dot stepper with connector lines at the top of
  the modal (completed = filled accent + check icon, current = accent ring +
  aria-current="step", upcoming muted; labels hide under 700px via CSS). Fixed modal
  title "Set Up ShipMath"; step titles moved into step content.
- ✅ NEW `StepHeader.tsx` (+ shared `FeatureRow`/`StateRow`): brand icon tile (40px/
  32px accent-subdued) + headingMd title + one-line muted description; every step now
  opens with the same rhythm.
- ✅ Steps redesigned (no flow-semantics changes, labels/docs intact): Welcome feature
  rows (ListBulleted/Delivery/PlayCircle), Plan capability rows (check vs minus:
  Delivery rules / Carrier rates per class), Zones card rows w/ globe icons + Draft
  badges + dashed empty state, Rates AI card gained MagicIcon tile + "Coming soon"
  badge (form open now replaces the cards), Carrier explanation under delivery-icon
  header + toggle in its own card, TestMode copy in a card, Done summary as
  StateRow checklist.
- ✅ Footer: Back + Skip for now / Close without finishing moved to modal
  secondaryActions (in-content plain button removed).
- ✅ brand.css +~120 lines of scoped `.sm-wizard-*` styles (stepper, tiles, rows,
  empty state; Polaris tokens with literal fallbacks for dark-scheme safety).
- ✅ Docs same run: getting-started.md progress-counter sentence rewritten for the
  stepper (all step walkthroughs verified still accurate).
- ✅ Step-consistency pass (user report, same day): every step now follows ONE
  layout (StepHeader → one Card body → muted footnote outside); Rates' two
  cards merged into one with a divider; Carrier/TestMode/Plan footnotes moved
  outside their cards; Welcome/Done card-wrapped.
- ✅ Carrier/TestMode alignment round 2 (user report "carrier rates design not
  fixed yet"): Carrier's 3-line header description → one-liner, and its lone
  toggle now sits under an explanation paragraph + divider (structure mirrors
  the Plan card exactly); TestMode got the same treatment (one-line header,
  state paragraph + divider + preview guidance in the card). Every step header
  is now a single line; every card has text content above its interactive
  part. Gates: tsc 0 · 329 tests · build clean.
- ✅ Inline zone form (user report, same day): zones no longer stack a second
  modal on the wizard. NEW `app/components/zones/ZoneForm.tsx` = the full
  form extracted from ZoneEditorModal (RuleForm conventions: parent owns the
  fetcher, own action row, draft mode hides the enabled toggle);
  ZoneEditorModal is now a thin wrapper around it (Zones page unchanged in
  behavior; footer buttons moved into the form body); the wizard's Zones
  step embeds ZoneForm inline exactly like the Rates step embeds RuleForm
  (SetupWizard owns zoneFetcher; success collapses the form and the
  revalidated list shows the Draft row). wizard-zone-create intent unchanged;
  WizardActionReply gained fieldErrors for the 422 path. getting-started.md
  zones step updated (form opens in the step; Press Save draft).
- ✅ Geometry fixes (user report 2026-09-10): (1) completed-dot checkmark sat 4px
  left/up — root cause `.Polaris-Icon` is a display:block 1.25rem span whose svg
  fills 100% of it, so sizing the svg alone parks it top-left; fix sizes the
  WRAPPER (`.sm-wizard-dot .Polaris-Icon {12px}`, same for the 32px tiles). (2)
  Connectors stopped up to 12px short of wide-label dots (step spans were label-
  wide, not dot-wide); fix: equal-width flex columns (flex: 1 1 0) + connector as
  an absolutely positioned ::before spanning dot-edge to dot-edge
  (left: calc(-50% + 13px) / right: calc(50% + 13px), top: 12px), fill states
    repeated with :not(:first-child) to out-specify the base rule. Verified by a
  static DOM harness measured with Playwright: tick offset (0.01, -0.01)px, all
  connector gaps ≤ 0.02px (old: -4px tick offset, 12.29px gaps).
- ✅ Gates: tsc 0 · root vitest 23 files / 329 tests · build clean. Extension untouched.

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
