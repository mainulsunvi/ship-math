# Plan — 003: Setup Wizard & Plan-Based Guidance

Spec: `.specs/003-setup-wizard-plan-guidance.md` · Depends on: 004/005 (zone/rule
editors), 007 (probe + go-live). Architecture: §A2, §A3 (probe), §A5 (prefs).
Estimate: 2 days.

## Task 1 — Plan classification (`app/lib/plan.ts`, pure + tested)

```ts
export type PlanClass = "FUNCTIONS_ONLY" | "CCS_ELIGIBLE" | "ALL";
export function classifyShopPlan(input: { displayName?: string | null; partnerDevelopment: boolean; shopifyPlus: boolean }): PlanClass;
export function planGuidanceBannerTone(planClass: PlanClass): "info" | "success" | "warning";
```

Heuristics per §A2: `partnerDevelopment` → ALL; displayName containing
"plus"/"advanced", or "basic"/"grow" + "annual"/"yearly" → CCS_ELIGIBLE; otherwise
"basic"/"grow" monthly → FUNCTIONS_ONLY; unknown display names default to
CCS_ELIGIBLE (probe decides — never block a shop from trying). Unit tests cover
the displayName matrix including the unknown-default.

## Task 2 — `shop/update` webhook (topic addition, no scope change)

- `shopify.app.toml` `[webhooks]` adds `shop/update` → `/webhooks/app/shop-update`
  (batch with Task 2 commit; verify topic URI with the toolkit if unsure).
- `app/routes/webhooks.app.shop-update.tsx`: HMAC-verified (existing pattern),
  upsert `Shop.plan` + `name` idempotently (criteria: retry-safe).

## Task 3 — PlanBanner + prefs (`app/components/global/PlanBanner.tsx`)

- `app.tsx` layout: load planClass once; banner per §A2: FUNCTIONS_ONLY → "delivery
  customization works on your plan"; CCS_ELIGIBLE (+ probe says CCS_OFF) → "Enable
  Carrier-Calculated Shipping" + doc link; dismiss writes
  `prefs.planBannerDismissedFor = planClass` (§A5 — derive-and-store helper
  `updatePrefs(shopId, patch)` in db.server, JSON merge).
- Reappears when planClass changes (compare stored value, not a timestamp).

## Task 4 — Wizard shell + steps (`app/components/setup/*`)

`SetupWizard.tsx` — Polaris Modal multi-step (INSTRUCTION: modals over routes);
steps as separate components (Welcome, PlanGuidance, Zones, Rates, TestMode, Done):

- **Gate**: `app._index` loader — `onboardedAt == null` → render wizard open.
- **Drafts**: zone/rule steps create rows with `enabled: false` via the EXISTING
  editors (004/005 components) — wizard does not fork editor logic.
- **PlanGuidance**: shows classified plan + copy per PlanClass; carrier step only
  rendered for CCS_ELIGIBLE/ALL (criterion 2: assert no `carrierServiceCreate`
  call on Basic — test double).
- **Rates step**: offers "Set up with AI" (renders placeholder until 009 ships;
  declining must not block — criterion 5) and manual fallback to the rule editor.
- **Carrier step (CCS shops only)**: `probeCcs()` → ELIGIBLE → offer go-live
  (`ensureCarrierService`, then note callback URL); CCS_OFF → guidance banner +
  Functions-path completion stays available (criterion 3).
- **Final commit action** (`wizard-complete` intent): flip drafted rows
  `enabled: true`, set `onboardedAt`, `ensureFunctionOwner`, `pushFunctionConfig`,
  optional carrier registration. Abandonment leaves only disabled drafts
  (criterion 6); skip-everything still yields valid empty config (criterion 7 —
  mirror validates, assert bytes ≤ cap).

## Task 5 — Settings integration

"Restart setup" button (Settings) clears `onboardedAt` → wizard reappears.
Dev-store path (criterion 4): carrier registration + callback reachable —
coordinate with 007's local tunnel.

## Acceptance mapping

1 → Task 4 gate · 2 → plan gating + test double · 3 → probe copy · 4 → dev run ·
5 → AI placeholder · 6–7 → draft/commit semantics · 8 → Task 2 + 3 (plan change →
banner reappears).

## Do NOT

- Never probe CCS on FUNCTIONS_ONLY shops (creates junk registrations).
- Do not store checklist/banner state in new columns — `prefs` only (§A5).
- Do not fork the zone/rule editors inside the wizard — reuse the components.
- OQ-1 (probe acceptability) is RESOLVED per §A3 — probe + immediate delete;
  OQ-2 (displayName heuristic) resolved in Task 1 defaults. Ask if new doubts arise.
