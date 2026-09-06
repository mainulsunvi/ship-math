# 001 — Foundation & Embedded Admin Shell

## 1. Problem statement

ShipMath must be installable, embedded in the Shopify admin, and pass Shopify review
before any shipping logic exists. The scaffold provides OAuth, session storage and a
demo product-creation route; it lacks the required GDPR webhooks, correct access
scopes, application navigation, and a shop-level identity record that later specs
depend on. This spec establishes the compliant baseline everything else builds on.

## 2. Data model decision

**Prisma table: `Shop`** (not metafields). The shop row is the anchor for zones,
rules, logs and onboarding state in later specs; Shopify has no native "app settings"
storage that our carrier endpoint can read cheaply.

- Read path: `authenticate.admin()` → upsert-by-domain on each embedded page load
  (cheap, indexed on `shopDomain` unique).
- Write path: upsert on first authenticated request; refreshed by `shop/update`
  webhook (spec 003 relies on the cached plan fields).

`Session` (existing, from the template) is untouched. No Shopify resources are
persisted at this layer.

## 3. Admin GraphQL operations

- `SHOP_DETAILS` — `query { shop { id name myshopifyDomain plan { partnerDevelopment shopifyPlus displayName } currencyCode } }`
  in `app/graphql/shop.ts`. Called once per shop upsert, cached in the `Shop` row.
  No loops; single call.

## 4. Access scopes required

`shopify.app.toml` changes: `write_products` → `read_products, read_delivery_customizations, write_delivery_customizations`.

> ⚠️ **Scope change forces merchant reauthorization.** Ship this before any merchants
> install. The `delivery_customizations` scopes drive the Function-owner lifecycle in
> spec 006 (validator-confirmed 2026-09-05 — `write_shipping` was NOT required).
> `write_shipping`/`read_shipping` are deferred to spec 007 (carrier registration).

## 5. Webhook topics consumed

| Topic | URI | Purpose | Idempotency key |
|---|---|---|---|
| `app/uninstalled` | `/webhooks/app/uninstalled` | Delete `Shop` row (cascades) + sessions | `shopDomain` — delete is idempotent |
| `app/scopes_update` | `/webhooks/app/scopes_update` | Update cached scope list | `shopDomain` + hash of scopes |
| `shop/update` | `/webhooks/shop/update` | Refresh plan/name on `Shop` | `shopDomain` + `updatedAt` compare |
| `customers/data_request` | `/webhooks/customers/data_request` | GDPR mandatory | `shopDomain` + payload id |
| `customers/redact` | `/webhooks/customers/redact` | GDPR mandatory | `shopDomain` + payload id |
| `shop/redact` | `/webhooks/shop/redact` | GDPR mandatory — erase everything | `shopDomain` — erase is idempotent |

All handlers must verify HMAC (template's `authenticate.webhook`).

## 6. File-by-file change list

- `shopify.app.toml` — scopes + new webhook subscriptions.
- `prisma/schema.prisma` — add `Shop` model.
- `prisma/migrations/*` — migration for `Shop`.
- `app/graphql/shop.ts` — `SHOP_DETAILS` query (new).
- `app/db.server.ts` — add `upsertShop()` / `getShop()` function declarations.
- `app/routes/webhooks.shop.update.tsx`, `webhooks.customers.data_request.tsx`, `webhooks.customers.redact.tsx`, `webhooks.shop.redact.tsx` — new handlers.
- `app/routes/webhooks.app.uninstalled.tsx` — extend to delete `Shop` row.
- `app/components/global/ShipMathNav.tsx` — real navigation (Home, Zones, Rules, Simulator, Logs, Settings).
- `app/routes/app._index.tsx` — remove demo product mutation; dashboard placeholder cards.
- `app/routes/app.additional.tsx` — repurpose/redirect (decided in 005/008; placeholder for now).

## 7. Acceptance criteria

1. `shopify app deploy` succeeds; app installs on a clean dev store with no scope warning beyond the expected reauthorization screen (fresh install).
2. Sending a test `shop/redact` webhook via the CLI deletes the `Shop` row, all sessions, and returns 200 within 5s.
3. `app/uninstalled` followed by reinstall leaves no orphaned `Shop` rows (unique constraint proves it).
4. All six webhook topics appear in `shopify.app.toml` and respond 200 to a signed test event; an unsigned request returns 401.
5. `Shop` row is created on first authenticated page load with `plan` populated from `SHOP_DETAILS`.
6. Nav renders on every `app.*` route with the six sections and active-state highlighting.

## 8. Open questions

1. Production database: SQLite (dev) must move to Postgres (Fly/Neon) before submission — which provider, and when do we cut over? (Blocks 002 migration review, not dev.)

## Standard scenarios

- **Uninstall → reinstall:** `app/uninstalled` deletes the `Shop` row and sessions; reinstall starts fresh via upsert. Proven by criterion 3.
- **Plan downgrade:** no tiered behavior exists yet; `Shop.plan` cache updates via `shop/update`. No action.
- **Partial webhook failure/retry:** all handlers idempotent by `shopDomain`; retries are safe (delete/erase/upsert). Non-2xx triggers Shopify retry — handlers must not throw on duplicate work.
- **Large catalog:** no catalog reads in this spec; `SHOP_DETAILS` is a single call regardless of catalog size.
