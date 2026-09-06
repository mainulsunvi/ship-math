# 010 — Review Submission Kit

## 1. Problem statement

Shopify review blocks the launch; FEATURES §3.6 lists the exact platform requirements
that fail review when missing. This spec packages everything a reviewer needs to test
the full loop on a development store — checklist UI, in-app documentation links,
privacy/terms pages, listing assets, and reviewer test instructions — so submission
is a checklist execution, not a scramble.

## 2. Data model decision

No schema change. The onboarding checklist state derives from existing data:
`Shop.onboardedAt`, zone count, rule count, a completed simulation (RequestLog
`source: SIMULATION`), go-live state (carrier registration). A JSON `dismissedHints`
field on `Shop` (added in 003's prefs) suppresses the checklist card on demand.

- Read path: dashboard loader aggregates the checklist booleans.
- Write path: none new (existing actions move the booleans).

## 3. Admin GraphQL operations

- `LIST_CARRIER_SERVICES` (reuse, 007) — checklist item "carrier registered (live)".
- No new operations. Privacy/terms are static pages in-app linking to hosted documents.

## 4. Access scopes required

Final verification only: scopes in `shopify.app.toml` are exactly
`read_products, read_shipping, write_shipping` and are all used (reviewers flag
unused scopes). App Pricing is configured in the Partner Dashboard submission form —
plans per FEATURES §6 (dev stores free, $29 Pro w/ 14-day trial, $290 annual); **no
Billing API code**.

## 5. Webhook topics consumed

Verification matrix for the six topics from 001 (signed test events, 200 responses,
idempotency) — no new topics.

## 6. File-by-file change list

- `app/components/onboarding/ChecklistCard.tsx` — reusable checklist (items: install ✓, plan guidance seen, zone created, rule created, simulation run, test mode understood, go-live reviewed) with deep-links into the relevant surfaces.
- `app/routes/app._index.tsx` — mount checklist until dismissed/complete.
- `app/routes/app.help.tsx` — in-app documentation page: how rates work, Functions vs CCS, simulator guide, FAQ links.
- `app/components/global/HelpLinks.tsx` — footer links (Privacy policy, Terms, Support) used on Settings + Help; URLs to hosted docs (Partner-listed).
- `docs/REVIEWER_INSTRUCTIONS.md` — reviewer script: install on dev store → wizard → create zone+rule → simulate → verify function behavior at checkout → go-live (dev store) → verify callback rates; credentials-free.
- `docs/LISTING_ASSETS.md` — checklist for icon, 3+ screenshots, demo video script, demo store URL, keyword positioning copy per FEATURES §8.
- `docs/PRIVACY.md`, `docs/TERMS.md` — source copy for hosted pages (incl. AI assistant data-handling disclosure + fair-use cap language per §5.4/§6.3).

## 7. Acceptance criteria

1. Every FEATURES §3.6 item maps to either a shipped artifact or a Partner-Dashboard manual step tracked in `docs/LISTING_ASSETS.md`; audit shows none missing.
2. A reviewer following `docs/REVIEWER_INSTRUCTIONS.md` on a fresh dev store completes the loop in under 10 minutes without contacting support (dry-run executed and timed).
3. GDPR webhooks respond correctly to signed test events (re-verify 001 criteria 4) — evidence captured in the dry run.
4. Carrier callback responds in < 1s p95 on the dev-store dry run (supports FEATURES' "responds well inside Shopify's timeout").
5. Privacy/terms/help links render and open from within the embedded app.
6. Checklist card auto-completes items as the reviewer progresses (derivation correctness test).
7. App store listing assets checklist shows icon + 3 screenshots + demo video script + demo store URL ready.
8. `shopify app deploy` production config matches submission (scopes, webhooks, extensions, URLs) — diffed and recorded.

## 8. Open questions

1. Hosting URLs (production `application_url`, callback domain) — must be finalized before `docs/REVIEWER_INSTRUCTIONS.md` is accurate (depends on 001 open question 1).
2. Demo video production owner/date — marketing dependency, tracked in `docs/LISTING_ASSETS.md`.

## Standard scenarios

- **Uninstall → reinstall:** reviewer uninstall/reinstall path is explicitly part of the instructions (validates cleanup UX).
- **Plan downgrade:** dev-store reviewer flow is plan-unrestricted; live-store downgrade messaging verified via PlanBanner test (003).
- **Partial webhook failure/retry:** reviewer script includes a CLI-sent duplicate webhook to demonstrate idempotency.
- **Large catalog:** demo store seeded with a moderate catalog (≥ 100 products) to prove pagination-free config UX and Function performance.
