# 016 — Merchant Operations

> Status: **future / post-MVP**. Depends on: 002 (audit log), 005 (rule UI), 009 (AI apply/rollback patterns).

## 1. Problem statement

FEATURES §4.6: CSV import/export of zones, postal codes and rate tables; rule
versioning with change history and rollback; clone full configuration across stores;
bulk edit; multi-language and multi-currency rate titles; alerting when a cart
returns zero rates. The audit log from 002 becomes a first-class history browser.

## 2. Data model decision

- `RuleVersion` table: snapshot JSON per mutation, monotonic version per shop.
- Export format: CSV dialect documented in `docs/CSV_SCHEMA.md`; import runs the same
  Zod validation as the AI apply path (009) — one validation funnel for all writers.
- `StoreCloneToken`: one-time signed token for cross-store config copy.
- Alert rule: zero-rate alert destinations (email/webhook) on `Shop` prefs JSON.

## 3. Admin GraphQL operations

- `shopLocalesRead`-era queries for multi-language title variants (verify current
  surface) — read-only, paginated.

## 4. Access scopes required

Possibly `read_locales` — **verify; addition forces merchant reauthorization.**

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/lib/io/csv.ts` — parse/serialize with schema docs.
- `app/lib/io/import.ts` — validation funnel + dry-run diff (reuse 009's `DiffPreview`).
- `app/components/history/*` — version browser + rollback modals.
- `app/routes/app.import-export.tsx` — page with modals for import preview/export download.
- Migration for `RuleVersion`, alert prefs.

## 7. Acceptance criteria

1. Round-trip export→import yields identical config (golden-file test).
2. Invalid rows are reported line-by-line; partial import opt-in only.
3. Version rollback restores any prior snapshot exactly (round-trip test).
4. Cross-store clone requires token acceptance on the target store's admin.
5. Zero-rate alert fires once per configurable window (no alert storms).
6. Multi-language titles validated against locale list.

## 8. Open questions

1. Locale data storage: per-rule `titleTranslations` map vs translation framework hook.
2. Alert channel priority (email vs webhook) for v1 of this spec.

## Standard scenarios

- **Uninstall/reinstall:** versions/history cascade with shop.
- **Plan downgrade:** history depth capped per tier (configurable) — define caps when tiers split.
- **Partial webhook failure/retry:** none.
- **Large catalog:** CSV import bounded by row caps (10k rows) + streaming parse.
