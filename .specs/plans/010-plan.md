# Plan — 010: Review Submission Kit

Spec: `.specs/010-review-submission-kit.md` · Depends on: everything (checklist
derives from shipped surfaces). Architecture: §A5 (derived state). Estimate: 1–2 days.

## Task 1 — Checklist derivation + card

- `app._index` loader aggregates (§A5 — derived, never stored): installed (Shop
  exists), planGuidanceSeen (`onboardedAt != null` or prefs flag), zoneCreated
  (count > 0), ruleCreated (count > 0), simulationRun (∃ RequestLog SIMULATION),
  testModeUnderstood (testMode currently true OR prefs hint dismissed), goLiveReviewed
  (`carrierServiceId != null` OR prefs skip flag).
- `app/components/onboarding/ChecklistCard.tsx` — items with deep links; auto-
  completes as booleans flip (criterion 6); dismiss writes `prefs.checklistDismissedAt`
  (§A5); hidden once complete + dismissed.

## Task 2 — In-app help + links

- `app/routes/app.help.tsx` — how rates work, Functions vs CCS, simulator guide,
  FAQ; static content, Polaris Page.
- `app/components/global/HelpLinks.tsx` — footer links (Privacy, Terms, Support)
  on Settings + Help; URLs → hosted docs (OQ-1 dependency: final domain).

## Task 3 — Docs artifacts (`docs/`)

- `REVIEWER_INSTRUCTIONS.md` — script: fresh dev store → install → wizard →
  zone+rule → simulate → checkout Function verification → go-live (dev store) →
  callback rates → uninstall/reinstall. Credentials-free; includes the duplicate-
  webhook idempotency demo (§"Standard scenarios").
- `LISTING_ASSETS.md` — icon, 3+ screenshots, demo video script, demo store URL,
  keyword positioning per FEATURES §8.
- `PRIVACY.md` / `TERMS.md` — source copy incl. AI data-handling disclosure (§A6)
  + fair-use cap language (FEATURES §6.3).

## Task 4 — Final verification pass

- Scope audit: toml scopes all used (reviewers flag unused): read_products (plan?
  verify usage — SHOP_DETAILS doesn't need it; if unused by then, REMOVE it in the
  same commit as any other toml change).
- Webhook matrix re-test: all topics signed + idempotent.
- Dry run: execute REVIEWER_INSTRUCTIONS end-to-end on a fresh dev store, time it
  (<10 min target), capture p95 callback latency (<1s), record results in
  LISTING_ASSETS.md.
- `shopify app deploy` diff vs submission config (scopes, webhooks, extensions,
  URLs) — recorded.

## Acceptance mapping

1 → Task 3 audit · 2 → Task 4 dry run timing · 3 → webhook re-verify · 4 →
latency capture · 5 → Task 2 · 6 → Task 1 derivation test · 7 → assets checklist ·
8 → deploy diff.

## Do NOT

- Do not store checklist state — derive it (§A5).
- Do not submit with unused scopes; audit and prune.
- Do not invent hosting URLs — OQ-1 blocks final docs accuracy; ask the human.
