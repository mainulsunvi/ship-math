# Review — 003 (Setup Wizard & Plan-Based Guidance)

Verdict: **CHANGES REQUESTED** (1 REQUIRED, 3 SHOULD, 6 NOTE; nothing BLOCKED)
Reviewed: 2026-09-09 · Reviewer mode · Spec `.specs/003-setup-wizard-plan-guidance.md` · Plan `.specs/plans/003-plan.md`

Scope reviewed (working tree, uncommitted): `app/lib/plan.ts` + `__tests__/plan.test.ts`,
`app/graphql/shop.ts`, `app/services/shop-details.ts`, `app/db.server.ts` (ShopPrefs /
updatePrefs / readPrefs / saveShopPlanDetails), `app/routes/webhooks.app.shop-update.tsx` +
`__tests__/shop-update-webhook.test.ts`, `shopify.app.toml` (shop/update subscription),
`app/lib/zone-form.ts` + `__tests__/zone-form.test.ts`, `app/routes/app.zones.tsx`,
`app/lib/config-schema.ts` + `app/lib/repositories/rules.ts` (+ rules.test /
stored-rule-schema.test additions), `app/routes/app._index.tsx` (loader backfill + wizard
intents), `app/routes/app.tsx`, `app/routes/app.prefs.tsx`, `__tests__/db-prefs.test.ts`,
`__tests__/wizard-intents.test.ts`, purity-guard additions, `app/components/global/PlanBanner.tsx`,
`app/components/setup/*` (SetupWizard + 7 steps + wizard-shared),
`app/components/zones/ZoneEditorModal.tsx` (draft prop), `app/routes/app.settings.tsx`
(Setup card + restart-setup), docs (`getting-started.md` rewrite, README / faq / zones /
simulator touches).

Method note: no terminal tool was available in this session, so `git status` / `git diff`
could not be executed by the reviewer. Per the operator's statement and `.specs/PROGRESS.md`
("nothing committed since `6ae3fe5`"), the entire change set is uncommitted working-tree
state; every file above was read in full from the working tree instead of the diff, plus the
untouched consumers needed for regression checks (`RulesTable.tsx`, `RuleForm.tsx`,
`ShipMathNav.tsx`, `SettingToggle.tsx`, `Switch.tsx`, `HelpTooltip.tsx`, `ShipMathPage.tsx`,
`webhooks.app.uninstalled.tsx`, `webhooks.app.scopes_update.tsx`, `prisma/schema.prisma`).
Gates were NOT re-run (operator report: tsc 0 · root vitest 23 files / 328 tests · extension
8/8 · build clean); IDE diagnostics were checked clean on `app._index.tsx`, `SetupWizard.tsx`,
`app.prefs.tsx`, `plan.ts`, `RuleForm.tsx`.

## 1. Verdict: CHANGES REQUESTED

- **REQUIRED — `wizard-complete` re-enables deliberately-disabled rules and zones.**
  `app/routes/app._index.tsx:554-568` flips EVERY disabled row
  (`updateMany({ where: { shopId, enabled: false }, data: { enabled: true } })` for rules at
  :558 and zones at :562), justified in-code as "fresh-install semantics". That assumption
  breaks on two flows this app explicitly documents and sells:
  - **Restart setup** (Settings card, `app.settings.tsx:176-186`; `getting-started.md:130`;
    `faq.md` "Can I run the setup wizard again?"): all three surfaces promise "Only rules
    that are still disabled (drafts) will turn on … so restarting can never switch a running
    rule off." A merchant with a **seasonally-disabled zone** (`docs/help/zones.md:50`
    documents exactly this: "build a `Holiday shipping` zone in November, switch it off in
    January") or a **disabled duplicate copy** (duplicates are created `enabled: false`;
    `faq.md`: "The copy will appear right next to the original, ready for you to edit") who
    restarts setup and presses Finish gets those rows silently re-enabled, and the completion
    sync then mirrors them into live checkout. The StepZones "Draft" badge
    (`StepZones.tsx:42`) also mislabels any pre-existing disabled zone as a wizard draft.
  - Secondary symptom of the same root cause: the wizard's draft list is built from page 1
    only (`app._index.tsx:718-724`, `loaderData.rules` is the 50-row page), while
    `wizard-complete` flips ALL disabled rows — the Done-step summary and the flipped set
    can disagree.
  - Suggested fix (precise, not a rewrite): track wizard draft ids in `Shop.prefs` (§A5 is
    already the designated store for wizard/UI state, and the plan's "Do NOT" already forbids
    new columns). `wizard-zone-create` / `wizard-rule-create` append the created id via
    `updatePrefs` (e.g. `wizardDraftRuleIds` / `wizardDraftZoneIds`); `wizard-complete`
    scopes both `updateMany` calls to `{ shopId, id: { in: draftIds }, enabled: false }` and
    clears the keys afterwards (a deleted draft id simply matches nothing);
    `restart-setup` clears stale keys so an abandoned run can never re-flip. Feed the
    Done-step counts from the same prefs keys. The Settings / getting-started / faq copy
    then becomes literally true with no wording change. (Alternative accepted variant: flip
    only rows created while `onboardedAt` was null, with a `wizardStartedAt` marker in
    prefs; the id-list is the more deterministic of the two.)
  - Adjudication of the flags raised by Tester + Documentation: **not acceptable-with-docs.**
  The docs chose to describe the code, but the code contradicts the docs' own "(drafts)"
  qualifier on three documented flows, and the failure mode changes live checkout state.

Everything else is SHOULD or NOTE (§3). Re-review after the REQUIRED item lands; expected
APPROVED.

## 2. Spec deviations found

| Location | Spec section | Deviation | Judgment |
|---|---|---|---|
| `app/routes/app._index.tsx:554-568` | 003 §2 write path; criterion 6 spirit | Finish flips ALL disabled rows, not only wizard drafts (see §1) | **REQUIRED** |
| `.specs/003-setup-wizard-plan-guidance.md` §Standard scenarios | "Uninstall → reinstall: wizard reruns on the fresh Shop row (by design)" | Contradicts the implemented AND documented behavior: `webhooks.app.uninstalled.tsx` keeps the Shop row (sessions deleted, carrier best-effort teardown only), so `onboardedAt` survives and the wizard does NOT rerun on reinstall. `faq.md` ("Your saved zones and rules will be kept. They are yours.") and spec 002's data-survival decision are the settled product behavior. | **SHOULD — amend the spec text** (documentation-only fix; do NOT change the webhook). Also see coverage note in §4: `wizard-intents.test.ts:359` simulates uninstall by deleting the Shop row directly, which the real webhook never does — add a companion assertion for the real path (onboardedAt survives → wizard stays closed) or a comment pointing at the spec amendment. |
| `app/components/global/PlanBanner.tsx:59-68`; `app/routes/app._index.tsx:596-600` | 003 §6 (PlanBanner "Enable Carrier-Calculated Shipping" **with doc link**) + criterion 3 ("guidance with a link to Shopify's docs") | No external link to Shopify's carrier-calculated-shipping documentation anywhere in the CCS_OFF guidance (wizard carrierNote) or the CCS_ELIGIBLE banner (it links internally to Settings only). | **SHOULD** — add a Polaris `Link` to Shopify's help-center CCS page in the banner body and/or the CCS_OFF carrier note. |
| 003 §Standard scenarios (plan downgrade) | "carrier service is left registered but the app shows guidance to disable" | `shouldShowPlanBanner` uses `carrierRegistered` only to suppress the CCS_ELIGIBLE banner; the FUNCTIONS_ONLY copy never mentions an already-registered carrier after a downgrade. Full auto-teardown is deferred to 019, but the promised guidance sentence is absent. | SHOULD — one tailored sentence in the FUNCTIONS_ONLY branch when `carrierRegistered` is true. |
| Wizard AI step | criterion 5 ("launches the AI flow (009)") | Placeholder card + disabled button; 009 is not built (plan-ready, needs env keys). Plan Task 4 explicitly says "renders placeholder until 009 ships; declining must not block". | Accept — deferred by plan; the decline-path and completion-without-AI are tested. |
| `app/lib/plan.ts:44-58` | 003 §3 `classifyShopPlan()` / `planGuidanceBannerTone()` | Matches, plus additive helpers (`PLAN_CLASS_LABELS`, `planClassFromShop`, `shouldShowPlanBanner`) that the plan's Task 3 needs. Unknown-displayName default CCS_ELIGIBLE per plan Task 1. | Accept |
| `shopify.app.toml` [webhooks] | 003 §5 | `shop/update` → `/webhooks/app/shop-update` added; no scope change (§4 respected). | Accept |

## 3. Convention violations

1. **SHOULD — `app/components/ui/HelpTooltip.tsx:26`: `paddingTop: "5\t px"` contains a
   literal TAB inside the CSS value** (invalid; the padding silently never applies) and the
   surrounding style object mixes tabs and spaces. Fix: `"5px"` + reindent. (Found while
   verifying the HelpTooltip pattern; the pattern itself is used correctly in `RuleForm.tsx`
   `RuleFormSection`.)
2. NOTE — pluralization helper duplicated: `pluralCount` (`wizard-shared.ts:26`) vs
   `countLabel` (`app._index.tsx:490`) — same rule, two implementations; collapse into
   `wizard-shared.ts` (or a tiny `app/lib/format.ts`) next pass.
3. NOTE — UX writing rule 6 ("every sentence starts with a capital letter, including
   fragments after a '·' separator"): `app._index.tsx` Environment card ("· soft cap 500
   rules.", "· page 1 of 2", "· manage in Settings") and `app.zones.tsx:296`
   ("· newest first") start lowercase after the separator. These strings predate today's
   directive but live in files this change touched; sweep them when the REQUIRED fix touches
   the same files.
4. NOTE — `app/components/rules/RuleForm.tsx:281` helpText "Enter a Rule name for
   reference." capitalizes "Rule" mid-sentence.
5. NOTE — `PlanBanner.tsx:42` and `ShipMathNav.tsx:131` wrap content in
   `className="quantible-custom-max-width"`, which is NOT defined in `brand.css` (the design
   run removed it). Harmless (Polaris `Page` supplies the width) but the dead class name
   should go.

Clean on the rest of the binding set, verified by reading every touched UI file:
- Switch convention: the only new boolean control (StepCarrier "Register carrier rates")
  uses `SettingToggle`, which wraps `app/components/ui/Switch.tsx`. No Checkbox / raw
  SettingToggle-style toggles anywhere in the change.
- Title Case headings vs sentence-case buttons/labels: wizard step titles ("Finish Setup",
  "Delivery Zones"), banners ("Setup Complete", "Setup Saved, Sync Failed", "Delivery Rules
  Work on Your Plan", "Checkout Mirror Out of Date"), table headings, and card sections
  ("Set Up With AI", "Set Up Manually") are Title Case; buttons ("Finish setup", "Continue",
  "Back", "Skip for now", "Save draft", "Create a rule draft", "Add a zone", "Dismiss",
  "Restart setup", "Open simulator") and field labels are sentence case.
- Em/en-dashes: grep across `app/**/*.tsx` — every hit is a code comment or the allowed lone
  `"—"` table placeholder (`RulesTable.tsx:71,90,112`, `GoLiveCard.tsx:105`,
  `CheckoutSummary.tsx:305`, `app.zones.tsx:227,300,303`). No UI-string violations.
- No raw enums in UI: `PLAN_CLASS_LABELS` is used by StepPlanGuidance and PlanBanner;
  evaluation modes use `EVALUATION_MODE_OPTIONS`; Yes/On/Off wording for test mode.
- Pluralization: `countLabel`/`pluralCount` ("1 rule", "2 draft rules"); no "rule(s)".
- HelpTooltip pattern: longer explanations ride the info icon (`RuleFormSection` help on
  Conditions/Action); field `helpText`s stay one sentence.
- `useFetcher` for every mutation (SetupWizard rule/complete fetchers, ZoneEditorModal's own
  fetcher, PlanBanner dismiss, Settings restart); no `<Form>` posts.
- GraphQL reuse: `SHOP_DETAILS` defined once in `app/graphql/shop.ts`, consumed by
  `services/shop-details.ts`; nothing redefined.
- Function declarations throughout new code (`plan.ts`, `shop-details.ts`, `zone-form.ts`,
  setup components, webhook handler matches the existing `export const action = async`
  scaffold pattern used by `webhooks.app.uninstalled.tsx` / `app.scopes_update.tsx`).
- docs/help style (8 binding rules): `getting-started.md` rewrite + touches verified —
  you/your POV, visible `[Add ... Screenshot]` / `[Add ... Video Tutorial]` placeholders,
  future tense throughout, no "we/us/our", grep confirms zero em/en-dashes in `docs/help/**`.

## 4. Missing coverage / criteria matrix

| # | Criterion | Evidence | Status |
|---|---|---|---|
| 1 | Fresh install → wizard open; completing sets `onboardedAt`; reload stays closed | `wizard-intents.test.ts` "completing on an empty shop stamps onboardedAt…" + "loader gate" | Covered |
| 2 | Basic plan never sees CCS prompts; no `carrierServiceCreate` (test double) | `wizard-intents.test.ts` "Basic plan + carrier requested: probeCcs and ensureCarrierService are NEVER called" (vi.fn doubles); carrier step not rendered for FUNCTIONS_ONLY (`SetupWizard.buildSteps`); server re-guards in `handleWizardComplete` | Covered |
| 3 | CCS probe fail → "Enable CCS" guidance + doc link; completes via Functions path | Completion path covered ("probe says CCS_OFF…"); **doc link missing** (§2 SHOULD) | Partial |
| 4 | Dev store completes carrier path end-to-end | Automated slice: "dev store completes the carrier registration path" (ensureCarrierService spy). Live callback reachability is inherently manual (007 lane). | Partial → §manual |
| 5 | "Set up with AI" offered; declining doesn't block | Placeholder card (`StepRates.tsx`) per plan Task 4; every completion test runs without AI | Covered (placeholder semantics) |
| 6 | Abandonment leaves only disabled drafts; no orphaned enabled rules | `wizard-intents.test.ts` criterion-6 block (disabled rows, NO admin API call, 422 paths write nothing) | Covered |
| 7 | Skip-everything → valid empty config within cap | "fresh-shop completion pushes a parseable empty config" (`{v:1,t:1,m:"F"}` + empty variables, ≤ SOFT_CAP_BYTES) | Covered |
| 8 | `shop/update` plan change → PlanBanner on next load | `plan.test.ts` `shouldShowPlanBanner` reappear-on-class-change (incl. downgrade case); `shop-update-webhook.test.ts` pins the write path incl. empty-plan→null; `app.tsx` loader wiring verified by reading (no direct route test — accepted, pure logic is tested) | Covered |

Coverage gaps (non-blocking): the reinstall test (`wizard-intents.test.ts:359`) exercises
the schema cascade + fresh-row path but not the REAL webhook behavior (Shop row survives);
`app.prefs.tsx` action and the `app.tsx` banner wiring have no direct route tests (pure
decision logic is pinned in `plan.test.ts` / `db-prefs.test.ts`).

## 5. Reuse / no-drift checks (requested)

- Wizard reuses `RuleForm` (StepRates embeds it in create mode with `submitLabel="Save
  draft"`) and `ZoneEditorModal` (draft prop flips the intent to `wizard-zone-create` and
  hides the enabled toggle behind "Draft zones turn on when you finish setup."). No forked
  editor logic; ActionEditor / ConditionGroupEditor / KindChip / SettingToggle /
  HelpTooltip all flow through the shared components.
- `zone-form.ts` extraction is faithful: same error strings and normalization as the zones
  route/modal ("Zone name is required.", "Select at least one destination country (or
  worldwide).", PARTIAL UK/CA rules via `validatePostalRuleForCountries`); both
  `zone-create`/`zone-update` (zones route) and `wizard-zone-create` (dashboard) parse
  through the one function. `zone-form.test.ts` pins it (previously uncovered).
- Carrier registration goes through the existing `services/carrier-registration.ts`
  (`probeCcs` / `ensureCarrierService`), never raw GraphQL in the route; sync via the
  existing `syncAfterOwnerEnsure`; owner ensure unchanged. `SHOP_DETAILS` reused, not
  redefined.
- Purity: `plan.ts` (zero imports) and `zone-form.ts` (zod + config-schema + postal) are in
  the purity-guard allowlist; UI grew no business logic (plan classification, banner
  decision, and form validation all live in pure/server modules); Backend did not edit UI
  beyond its own route handlers.

## 6. Regression risk (requested)

- Loader shape changes: `zones` gained `enabled` — `RulesTable` / `RuleForm` zone pickers
  read `id`/`name` only and are structurally tolerant (verified). `planClass` /
  `onboardedAt` / `shopName` are additive fields.
- `RuleInput` → `z.input`: all three `parseRuleForm` call sites construct inputs without
  `enabled` and compile clean (IDE diagnostics + operator tsc gate). `updateRule` still
  never writes `enabled` (pinned by the new "smuggled enabled:true … is ignored" test);
  `duplicateRule` re-validates stored rows through the defaulted schema but inserts
  `enabled: false` explicitly.
- `ZoneEditorModal` default path: `zone`/`onClose` contract unchanged; `draft` defaults to
  false and the intent ternary resolves to the original `zone-create`/`zone-update`; the
  zones page renders it exactly as before (key/zone/onClose).
- `app.tsx` layout resilience: the whole loader (auth → shop → backfill → prefs) sits in
  one try/catch that degrades to `planClass: null, showPlanBanner: false`; the banner is
  guidance, never a gate — verified the page cannot 500 from the new code path.
- Shared modules untouched: `zone-matching`, `rule-evaluation`, carrier engine, evaluator
  consumers (carrier callback, simulator, Function parity) are unaffected by this change
  (`config-schema` change is additive with a default).

## 7. Known flags adjudicated (as instructed)

- **(a) wizard-complete flips all disabled rows → REQUIRED** (§1).
- **(b) Reinstall scenario vs data survival → documentation-only fix**: amend spec 003's
  "Standard scenarios" wording to match the implemented, spec-002-documented behavior (Shop
  row survives uninstall; wizard does NOT rerun on reinstall; "Restart setup" in Settings is
  the re-entry point). No code change; the uninstall webhook is correct as written.
- **(c) prefs action route → CLEAN**: `app.tsx` has no `action` export (loader only);
  `PlanBanner.tsx:32` posts `{ intent: "dismiss-plan-banner" }` with
  `action: "/app/prefs"`; grep confirms no other submitter of that intent and no fetcher
  targeting the deleted `app.tsx` action. `app.prefs.tsx` is action-only (no default
  export), same shape as the webhook routes.
- **(d) Webhook `console.log` parity → CLEAN**: `webhooks.app.shop-update.tsx:27` logs the
  exact `` `Received ${topic} webhook for ${shop}` `` line used by `app.uninstalled` and
  `app.scopes_update`.

## 8. Standard scenarios (the four, always)

- **App uninstall → reinstall:** Shop row survives (sessions purged, carrier teardown
  best-effort) → zones/rules/prefs/onboardedAt survive → wizard stays closed on reinstall,
  matching spec 002 + `faq.md`; the spec-003 scenario sentence is the outlier (§2 amendment).
  The cascade + fresh-row variant is tested (`wizard-intents.test.ts:359`).
- **Plan downgrade while data exceeds limits:** nothing tier-gated in 003; banner
  reappears on class change (tested); carrier stays registered with generic guidance
  (§2 SHOULD for the tailored sentence); ≥400 soft-cap banner untouched.
- **Partial webhook delivery + retry:** `shop/update` handler is a plain field upsert;
  duplicate-delivery test proves one row / same values; empty `plan_display_name`
  normalizes to null (re-classification path) — tested both at the route and repository
  level.
- **Unusually large catalog:** the wizard never enumerates the catalog; rules paginate at
  50 with the gate unaffected (dedicated 55-rule test); zones are merchant-bounded;
  `ensureShopPlanDetails` makes at most one Admin API call per load when plan+name are
  stored (NOTE: shops whose `plan_display_name` is legitimately empty re-fetch once per
  load — acceptable, worth a marker sentinel if it ever matters).

## 9. Positive notes

- Orchestration discipline holds inside the wizard: drafts never touch the Admin API
  (asserted), completion commits Prisma + `onboardedAt` BEFORE the sync/carrier steps so a
  push failure can never reopen the wizard, and the failure lands as a report + dashboard
  retry — exactly the §A1 failure semantics.
- The test suite is genuinely integration-grade: real fixture DB, wholesale
  `shopify.server` mock, stub admin programmed per query, carrier spies for criterion 2's
  test double, and assertions on the pushed metafield bytes (criterion 7's ≤ cap).
- `ensureShopPlanDetails` never throws and degrades to the permissive class; the layout
  loader wraps everything so the embedded app cannot 500 from guidance code.
- Dismissal keyed to the CURRENT plan class (server-recomputed on dismiss) is the right
  shape for criterion 8; prefs helpers are corrupt-safe and forward-compatible (tested).
- Docs shipped with code and match the UI's actual strings ("Finish setup", "Draft" badge,
  "Register carrier rates", "Step 2 of 7") — rare and good.

## §manual — human smoke script (run after the REQUIRED fix)

1. Fresh dev install: load `/app` → wizard opens on Step 1 of 7 with the store name;
   reload mid-way → wizard reopens, drafts still listed and disabled (Draft badges).
2. Basic-plan store: walk to the end — NO Carrier Rates step; finish with carrier requested
   (if you can force it via devtools) → no carrier service appears in Shopify Settings →
   Shipping (verify no junk registration).
3. CCS-eligible store: Carrier Rates step present; finish with the switch on → "ShipMath"
   carrier service exists; place a checkout → callback rate appears.
4. Abandon on the rates step after creating a zone + rule draft → Dashboard shows the rows
   disabled; nothing changed at checkout; simulator shows no operations.
5. Finish with zero drafts → "Setup Complete" banner, 0 rules and 0 zones enabled; reload →
   wizard stays closed.
6. Kill network before Finish (or revoke the metafield scope) → "Setup Saved, Sync Failed"
   message; Retry sync on the dashboard recovers; wizard does not reopen after reload.
7. **Restart-setup regression (the REQUIRED item):** disable one rule and one zone
   deliberately, run Restart setup, finish → those two rows must STAY disabled; only true
   wizard drafts turn on.
8. Plan change: switch the dev store's plan simulation (or hand-edit `Shop.plan`) → banner
   reappears after dismissal; dismiss persists per class.
9. Uninstall + reinstall → zones/rules still present, wizard does NOT auto-open; Sync now
   restores checkout.

— Reviewer, 2026-09-09

---

## Re-verification — 2026-09-09 (orchestrator fixes applied)

- **REQUIRED fixed**: `wizard-complete` now flips EXACTLY the rows recorded in
  `prefs.wizardDraftRuleIds` / `prefs.wizardDraftZoneIds`. `handleWizardZoneCreate` /
  `handleWizardRuleCreate` append ids via `db.server.appendWizardDraftId`; completion scopes
  both `updateMany` calls to `id in (draftIds)` and clears the lists; `restart-setup` clears
  them too. New regression test "rows disabled OUTSIDE the wizard stay disabled at
  completion" (plus draft creation routed through the real wizard intents in the
  commit-semantics suite) pins the behavior. Gates: tsc 0 · root vitest 23 files / 329
  tests · build clean · extension 8/8 (untouched).
- **SHOULD fixed**: CCS banner copy now links Shopify's carrier-accounts help doc
  (external Link); the FUNCTIONS_ONLY banner gained `carrierRegistered`-aware downgrade copy
  (wired through the `app.tsx` loader, which now returns `carrierRegistered`);
  `HelpTooltip.tsx` `paddingTop: "5\t px"` tab-corrupted value corrected to `"5px"` and the
  mangled style indentation normalized.
- Spec/code reinstall divergence resolved documentation-only: spec 003's "fresh Shop row"
  scenario line amended to match shipped behavior (Shop row survives uninstall; data kept;
  wizard does not auto-rerun; Settings offers Restart setup).
- NOTEs left as-is deliberately: `countLabel`/`pluralCount` near-duplicates (different
  layers), per-load plan re-fetch only for null-plan shops (one query, self-healing),
  ShipMathNav findings out of scope per the user-owned-file directive.

Verdict after fixes: **APPROVED**.

— Orchestrator, 2026-09-09
