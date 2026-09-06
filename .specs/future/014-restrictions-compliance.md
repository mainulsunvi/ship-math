# 014 — Restrictions & Compliance

> Status: **future / post-MVP**. Depends on: 004 (zones), 005 (rules), 006 (Function), 007 (engine).

## 1. Problem statement

FEATURES §4.4: block products from regions (hazmat, alcohol, oversized), PO Box/APO/
military address blocking, address validation, residential vs commercial detection,
per-rate order minimums/maximums, blackout dates, cutoff times, lead/prep times, and
delivery-date estimates in the rate title.

## 2. Data model decision

- `Restriction` table: kind (REGION_BLOCK | PO_BOX | VALIDATION | RESIDENTIAL), matchers JSON, message key.
- Extend `RateAction`: `minOrderSubtotal`, `maxOrderSubtotal`, `blackoutDates` (ICAL-ish range list), `cutoffTime` (shop tz), `leadTimeHours`.
- Delivery-date estimation computed in carrier response title formatting; Function
  rename path composes the same string (shared formatter).

## 3. Admin GraphQL operations

None.

## 4. Access scopes required

None new.

## 5. Webhook topics consumed

| Topic | Purpose | Idempotency key |
|---|---|---|
| `shop/update` | Timezone changes affect cutoff math | shopDomain + tz field hash |

## 6. File-by-file change list

- `app/lib/restrictions/pobox.ts` — regex + heuristics detector.
- `app/lib/restrictions/dates.ts` — blackout/cutoff/lead-time math (TZ-safe via `Temporal` polyfill or `date-fns-tz`).
- `app/components/restrictions/*` — editors.
- Engine + Function integration: restriction failures produce zero rates with explicit reason in the simulation trace (008).

## 7. Acceptance criteria

1. PO Box detector handles USPS-style variants (unit tests: "PO Box", "P.O. Box", "Box #", APO/FPO/DPO).
2. Blackout range blocks a checkout-window fixture; boundary days tested inclusive.
3. Cutoff in shop timezone respects DST transitions (fixture: spring-forward week).
4. Region block produces "cannot ship" state, distinct from "no rates configured", in simulator.
5. Delivery estimate titles format identically in carrier JSON and Function rename (shared formatter test).
6. Order min/max enforced before rate math.

## 8. Open questions

1. Address validation provider (Smarty/Loqate/none) — cost decision.
2. Residential detection via carrier APIs only (013 dependency) or standalone provider?

## Standard scenarios

- **Uninstall/reinstall:** restrictions cascade.
- **Plan downgrade:** restriction rules ignored on downgrade with notice (mirror version gate).
- **Partial webhook failure/retry:** shop/update idempotent field compare.
- **Large catalog:** region blocks match product attributes via mirrored data (011 pattern), not live catalog scans.
