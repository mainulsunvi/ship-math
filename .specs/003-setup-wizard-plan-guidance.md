# 003 — Setup Wizard & Plan-Based Delivery Guidance

## 1. Problem statement

Setup friction is the top churn driver in this category (FEATURES §5). ShipMath must
greet a first-time merchant with a wizard that collects the minimum viable
configuration and — per `docs/INSTRUCTION.md` — must steer Basic-plan merchants to
the Delivery Customization Function path (no CCS) and CCS-eligible merchants without
CCS enabled toward enabling CCS. The wizard is also the primary entry point for the
AI configure flow (spec 009) and must complete without any external dependency on it.

## 2. Data model decision

No new tables. `Shop.onboardedAt` (002) gates the wizard: null → wizard shows on
`app._index`; set → never auto-shows again ("Restart setup" available in Settings).
Wizard drafts persist in the existing zone/rule tables as **disabled** rows tagged
`source: WIZARD` in `AuditLog` until the final step commits `testMode` + enables them.

- Read path: `app._index` loader checks `onboardedAt`.
- Write path: wizard actions create zones/rules (disabled) → final action flips
  `enabled`, sets `onboardedAt`, ensures the function owner exists (006
  `ensureFunctionOwner`), optionally registers carrier (007).

## 3. Admin GraphQL operations

- `SHOP_DETAILS` (reuse from `app/graphql/shop.ts`, 001) — plan detection:
  `plan { partnerDevelopment shopifyPlus displayName }`. Single call, cached on `Shop`.
- Plan classification lives in `app/lib/plan.ts` as pure functions:
  - Basic/entry plans (`displayName` contains "Basic"/"Grow" monthly, not annual) → `FUNCTIONS_ONLY`.
  - Advanced/Plus/annual Basic & Grow → `CCS_ELIGIBLE`.
  - Dev stores (`partnerDevelopment`) → `ALL` (dev stores can register carrier services).

> ⚠️ There is **no Admin API field that directly reports whether CCS is enabled** on a
> shop. Detection strategy (decision, with open question 1): attempt
> `carrierServiceCreate` lazily at the "connect rates" step and classify the error —
> `carrier_service_not_allowed`-class errors mean CCS is off. The wizard never attempts
> this on Basic (FUNCTIONS_ONLY) shops.

## 4. Access scopes required

No change beyond 001. `write_shipping` covers the lazy `carrierServiceCreate` probe.

## 5. Webhook topics consumed

- `shop/update` (001) — if the cached plan changes after onboarding, the Settings page
  shows a re-evaluation banner ("You switched plans — review your delivery method").

## 6. File-by-file change list

- `app/components/setup/SetupWizard.tsx` — modal-based multi-step wizard (Polaris `Modal` + `AlphaStack`/`BlockStack`), per INSTRUCTION preference for modals over routes.
- `app/components/setup/StepWelcome.tsx`, `StepPlanGuidance.tsx`, `StepZones.tsx`, `StepRates.tsx`, `StepTestMode.tsx`, `StepDone.tsx` — one component per step, reused standalone where applicable.
- `app/lib/plan.ts` — `classifyShopPlan()`, `planGuidanceBannerTone()` declarations.
- `app/routes/app._index.tsx` — loader gate + wizard mount.
- `app/routes/app.tsx` — `PlanBanner` slot rendered above page content when plan state warrants (see below).
- `app/components/global/PlanBanner.tsx` — reusable banner: FUNCTIONS_ONLY → explains Delivery Customization works on Basic; CCS_ELIGIBLE + probe failed → "Enable Carrier-Calculated Shipping" with doc link; persistent-dismiss stored in `Shop` JSON prefs.

## 7. Acceptance criteria

1. Fresh install lands on `app._index` with the wizard open; completing it sets `onboardedAt`; reload does not reopen it.
2. A Basic-plan shop never sees CCS prompts — the wizard's rate step shows the Functions path only, and no `carrierServiceCreate` call is made (asserted via test double).
3. A CCS-eligible shop that fails the CCS probe sees the "Enable CCS" guidance with a link to Shopify's docs; the wizard still completes via the Functions path.
4. A dev store can complete the carrier path end-to-end (carrier registered, callback reachable).
5. "Set up with AI" is offered on the rates step and launches the AI flow (009); declining it does not block manual completion.
6. Abandoning the wizard mid-way leaves only disabled draft rows; no orphaned enabled rules.
7. Skipping all optional steps still produces a valid, empty-but-consistent config (mirror validates).
8. `shop/update` changing the plan after onboarding makes `PlanBanner` appear on next load.

## 8. Open questions

1. Is error-classification from a lazy `carrierServiceCreate` probe acceptable UX and review-safe, or should we ask the merchant "Have you enabled CCS?" instead? Decide before implementation; a wrong probe creates a junk carrier service row on success — mitigated by deleting the probe immediately after creation.
2. Should annual-Basic detection rely on `displayName` string matching? There is no structured `billingInterval`-for-plan field; confirm acceptable heuristic.

## Standard scenarios

- **Uninstall → reinstall:** wizard reruns on the fresh `Shop` row (by design).
- **Plan downgrade:** handled by `PlanBanner` re-evaluation (criterion 8); downgrade from CCS-eligible to Basic prompts the merchant to re-run setup in Functions mode; carrier service is left registered but the app shows guidance to disable (full auto-teardown deferred to 019).
- **Partial webhook failure/retry:** `shop/update` handler is an idempotent upsert of plan fields; retries safe.
- **Large catalog:** wizard never enumerates the catalog; product pickers (if added for preview) must use paginated resource picks — none required for MVP steps.
