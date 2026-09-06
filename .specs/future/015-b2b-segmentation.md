# 015 — B2B & Customer Segmentation

> Status: **future / post-MVP**. Depends on: 005 (rule conditions), 006 (Function).

## 1. Problem statement

FEATURES §4.5: rates by customer tag, by company and company location (B2B),
B2B catalog awareness, wholesale-only rates, account-specific negotiated pricing,
and logged-in vs guest differentiation.

## 2. Data model decision

- Extend condition field set with `customer_b2b_company`, `company_location_id`.
- `NegotiatedRate` table: companyLocationId → rate override JSON (app-side mapping).
- B2B catalog awareness: mirror-based — at config time, resolve catalog membership
  into product-tag hints (same pattern as 011 collection matchers).

## 3. Admin GraphQL operations

- `companies` / `companyLocations` queries (B2B) — paginated; used in editor pickers.
- Cost note: company pickers must cursor-paginate; no full listing in loaders.

## 4. Access scopes required

`read_customers` (tags), plus B2B company read scope if gated — **verify current
scope name during implementation; any addition forces merchant reauthorization.**

## 5. Webhook topics consumed

| Topic | Purpose | Idempotency key |
|---|---|---|
| `customers/update` | Refresh mirrored tags for rule pickers | customerId + updatedAt |

## 6. File-by-file change list

- `app/lib/conditions/b2b.ts` — condition evaluators.
- `app/components/rules/B2BPicker.tsx` — company/location picker modal.
- Migration for `NegotiatedRate`.
- Function input extension (buyer company fields) — confirm availability per API version.

## 7. Acceptance criteria

1. Customer-tag rules evaluate in simulator with tag fixtures.
2. Company-location rule matches only that location in a B2B cart fixture.
3. Wholesale-only rates hidden from guest simulations.
4. Negotiated rate overrides base rate for the mapped company location.
5. Customer tag mirror refresh is idempotent on webhook retry.
6. Picker paginates at 25 companies/page.

## 8. Open questions

1. Availability of company/location fields in delivery customization Function input for the target API version (same check as 006 open question 2).
2. Catalog-awareness depth: tag hints vs full catalog metaobject mirror — cost/latency tradeoff.

## Standard scenarios

- **Uninstall/reinstall:** negotiated rates cascade (company data is merchant config).
- **Plan downgrade:** B2B conditions ignored; base rules still apply.
- **Partial webhook failure/retry:** customers/update idempotent by id+updatedAt.
- **Large catalog:** B2B catalogs mirrored in batches (011 caps apply).
