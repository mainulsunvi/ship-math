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
