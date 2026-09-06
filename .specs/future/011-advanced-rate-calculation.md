# 011 — Advanced Rate Calculation

> Status: **future / post-MVP**. Depends on: 002 (config store), 004 (zones), 005 (rule builder), 007 (engine).

## 1. Problem statement

FEATURES §4.1 lists the advanced primitives competitors sell: dimensional/volumetric
weight, cubic volume rates, per-item dimensions via metafields, product groups,
per-item and per-pound rates, percentage-of-product-price, rate blending
(sum/max/min/cheapest/highest/weighted), multi-origin and per-location rules,
vendor/supplier-based rates, box-packing, fee caps, and shipping discounts. These are
the depth features that justify the $29 Pro tier after the MVP wedge is proven.

## 2. Data model decision

- `ProductGroup` table (id, shopId, name, matchers JSON: tags/SKUs/vendors/collections/metafield).
- `Package` table (box dimensions, max weight) + `PackingProfile` linking groups to packages.
- Extend `RateAction` JSON with `blend` (strategy + weight), `dim` divisor, `originLocationId`.
- Per-item dimensions sourced from product metafields (`dimensions.*`) read at config
  time into the mirror — Functions/carrier never metafield-join at runtime.

Read/write paths follow 002 (Prisma source of truth, metafield mirror for the Function).

## 3. Admin GraphQL operations

- `productMetafieldSet` variants — only if the app offers to *seed* dimension metafields; otherwise read-only.
- Collection queries for group matchers — paginated `collections` + `collection.products` (⚠️ cost in a loop: cap group membership syncs at 250 products/batch, cursor-based).

## 4. Access scopes required

`read_products` (have it). Collection reads: no extra scope. Seeding dimension
metafields would need `write_products` — restore it? Flag: **scope change forces
merchant reauthorization** if restored.

## 5. Webhook topics consumed

| Topic | Purpose | Idempotency key |
|---|---|---|
| `products/update` | Refresh mirrored dimension data | productId + updatedAt |

## 6. File-by-file change list

- `prisma/schema.prisma` + migration — `ProductGroup`, `Package`, `PackingProfile`.
- `app/lib/engine/dimension.ts` — dim weight + volume math.
- `app/lib/engine/blending.ts` — blend strategies.
- `app/lib/engine/packing.ts` — first-fit-decreasing box packer.
- `app/components/groups/*` — group editor modals.
- Mirror schema v2 with versioned `configVersion`.

## 7. Acceptance criteria

1. Dim weight uses merchant-set divisor; unit tests cover kg/cm vs lb/in.
2. Blending strategies unit-tested for sum/max/min/cheapest/highest/weighted.
3. Box packer packs a fixture cart within capacity bounds; unpackable items flagged.
4. Group matcher resolves tag/SKU/vendor/collection membership via mirrored data.
5. Mirror `configVersion` bump forces Function input schema compatibility check.
6. 250+ product group sync completes without throttling errors (batched cursors).

## 8. Open questions

1. Multi-origin: per-location rates need `location` context in callbacks — confirm availability in both Function input and carrier payload before committing the schema.
2. Weighted blending weights UI — numeric inputs or percentages?

## Standard scenarios

- **Uninstall/reinstall:** new tables cascade with shop.
- **Plan downgrade:** features ship inside Pro; downgrade hides editors and Function ignores advanced action types (forward-compatible mirror versioning).
- **Partial webhook failure/retry:** product/update idempotent by productId+updatedAt.
- **Large catalog:** group sync is the paginated hot path; batch caps + backoff verified by test.
