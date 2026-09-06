# ShipMath — Spec Index

Source of truth for features: `docs/FEATURES.md`. Project rules: `docs/INSTRUCTION.md`.

## Conventions

- One numbered spec per file: `NNN-slug.md` (zero-padded, monotonic, never reused).
- MVP specs live in `.specs/`. Non-MVP / roadmap specs live in `.specs/future/`.
- Every spec contains, in order: problem statement, data model decision, Admin GraphQL
  operations, access scopes, webhook topics, file-by-file change list, acceptance
  criteria, open questions.
- Every spec answers the four standard scenarios: uninstall/reinstall, plan downgrade,
  partial webhook failure + retry, large-catalog pagination.
- Open questions are never resolved silently — an implementer must ask, not guess.
- Architecture-level decisions are recorded in `architecture.md` when a spec changes them.
- Implementation plans live in `.specs/plans/` (see `000-implementation-order.md`);
  they reference specs/architecture and never re-decide — open questions go back to
  the human, per the rule above.

## Implementation plans (`.specs/plans/`)

| Plan | Covers | Status |
|---|---|---|
| [000-implementation-order.md](plans/000-implementation-order.md) | Master sequence, gates, scope warnings | READY |
| [004-005-plan.md](plans/004-005-plan.md) | Zones UI, rule builder, repositories | READY |
| [007-plan.md](plans/007-plan.md) | Carrier engine, callback, go-live | READY |
| [008-plan.md](plans/008-plan.md) | Simulator, explain traces, log viewer | READY |
| [003-plan.md](plans/003-plan.md) | Setup wizard, plan guidance | READY |
| [009-plan.md](plans/009-plan.md) | AI assistant | READY (needs env keys) |
| [010-plan.md](plans/010-plan.md) | Review kit | READY (needs hosting URL) |

## MVP (submission scope — v1.0)

| # | Spec | Area |
|---|------|------|
| 001 | [Foundation & embedded admin shell](001-foundation-embedded-shell.md) | OAuth, GDPR webhooks, nav, scopes |
| 002 | [Data model & configuration store](002-data-model-config-store.md) | Prisma schema, function-owner metafield mirror |
| 003 | [Setup wizard & plan-based guidance](003-setup-wizard-plan-guidance.md) | First-install wizard, AI entry point |
| 004 | [Zone & postal code targeting](004-zone-postal-targeting.md) | Country/province/postal, UK/CA partial |
| 005 | [Rule builder UX](005-rule-builder-ux.md) | IF/THEN builder, priority, modals |
| 006 | [Delivery Customization Function](006-delivery-customization-function.md) | Hide/rename/reorder, no CCS |
| 007 | [Carrier Service rate engine](007-carrier-service-engine.md) | Flat/free/tiered/incremental/percentage |
| 008 | [Test mode, simulator, rate log](008-test-mode-simulator-log.md) | Trust features — do not cut |
| 009 | [AI setup assistant](009-ai-setup-assistant.md) | NL → config, diff preview, postal parsing |
| 010 | [Review submission kit](010-review-submission-kit.md) | Checklist, listing assets, reviewer flow |

## Future / non-MVP (`.specs/future/`)

| # | Spec | Area |
|---|------|------|
| 011 | advanced-rate-calculation.md | Dim weight, product groups, blending, box packing |
| 012 | distance-geo-rates.md | Radius/driving distance, geocode cache |
| 013 | live-carrier-rates.md | FedEx/UPS/USPS/DHL, markups, aggregators |
| 014 | restrictions-compliance.md | PO box blocking, blackouts, cutoffs, estimates |
| 015 | b2b-segmentation.md | Customer tags, companies, wholesale rates |
| 016 | merchant-operations.md | CSV import/export, versioning, clone, bulk edit |
| 017 | analytics-margin-reporting.md | Impressions, selection rate, cost variance |
| 018 | ai-debugging-assistant.md | Reverse mode: "why this rate?" |
| 019 | scale-reliability.md | Edge cache, circuit breakers, status page |
