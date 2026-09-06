# 005 — Rule Builder UX

## 1. Problem statement

Merchants need to author, order, and maintain IF/THEN shipping rules without a
spreadsheet. The MVP rule builder must support AND/OR condition groups, priority
ordering, duplicate, per-rule enable/disable, and the first-match vs all-match
behaviour setting (FEATURES §3.4). Per `docs/INSTRUCTION.md`: Polaris React,
reusable components in `app/components/`, modals preferred over custom routes,
`useFetcher` + form actions for submissions.

## 2. Data model decision

No schema change — `ShippingRule`, `Zone`, `Shop.evaluationMode` from 002 carry
everything. UI works through the repository functions declared in 002.

- Read path: rules loader (paginated, 50/page, ordered by `priority`).
- Write path: rule mutations via `useFetcher` → action → Prisma → `pushFunctionConfig()` (002).

**Decisions:**
- Editing happens in a **modal** (`RuleEditorModal`) launched from the rules table; no
  per-rule routes.
- Priority ordering uses **up/down buttons** (Polaris has no first-party drag-and-drop);
  each move is a fetcher POST that swaps priorities. Bulk reorder deferred to 016.
- `Shop.evaluationMode` (FIRST_MATCH | ALL_MATCH) is a global setting on the Rules page
  header; per-rule `stopOnMatch` gives first-match semantics inside ALL_MATCH mode.
- The condition field set for MVP: `cart_subtotal`, `cart_weight`, `item_quantity`,
  `product_tag`, `sku`, `vendor`, `customer_tag`, `customer_logged_in`,
  `destination_country`, `destination_province`, `destination_postal` (zone-linked via
  `zoneId` for the destination trio — zone selection narrows the destination match).
- Rule `kind` drives the THEN form: `CARRIER_RATE` (rate params from 007), `HIDE`,
  `RENAME`, `MOVE` (function operations from 006).

## 3. Admin GraphQL operations

None directly (all via repository + mirror). Indirect: `metafieldsSet` inside
`pushFunctionConfig()` per mutation.

## 4. Access scopes required

None beyond 001.

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/routes/app._index.tsx` — becomes the Rules dashboard (list + summary cards + evaluation-mode setting).
- `app/routes/app.zones.tsx` — zone list page.
- `app/routes/app.tsx` — loader merge for counts if needed.
- `app/components/rules/RulesTable.tsx` — table with priority controls, enable toggle, duplicate, edit, delete.
- `app/components/rules/RuleEditorModal.tsx` — IF/THEN editor shell (modal).
- `app/components/rules/ConditionGroupEditor.tsx` — recursive AND/OR group editor (reused by simulator input, 008).
- `app/components/rules/ConditionRow.tsx` — single field/operator/value row with typed value inputs.
- `app/components/rules/ActionEditor.tsx` — kind-specific THEN forms (rate params / title / position).
- `app/components/zones/ZoneEditorModal.tsx` + `PostalRuleEditor.tsx` (shared with 004).
- `app/components/ui/SettingToggle.tsx` — reusable Polaris setting row (used across pages).
- `app/lib/rule-evaluation.ts` — `evaluateConditions(group, ctx): { matched: boolean, failedAt?: string }` pure evaluator shared with simulator; declares `orderRules(rules, evaluationMode)`.

## 7. Acceptance criteria

1. Creating a rule via modal with a nested AND/OR group persists and appears in the table at the chosen priority position.
2. Priority up/down swaps rows server-side; refreshing preserves the order.
3. Duplicate produces a copy named "… (copy)", disabled, adjacent priority (matches 002 criterion 5).
4. Enable/disable toggle round-trips and is reflected in the mirror JSON.
5. Evaluation-mode switch (FIRST_MATCH ↔ ALL_MATCH) persists on `Shop` and labels the table's behavior column correctly.
6. Every mutation flows through `useFetcher` with optimistic UI disabled (error banner + retry on failure — verify with a forced metafieldsSet failure test).
7. Rules list paginates at 50; the loader enforces the 500-rule soft cap warning banner.
8. A `stopOnMatch` rule in ALL_MATCH mode short-circuits lower-priority rules in `orderRules` output (unit-tested).
9. Deleting a rule updates the mirror and the audit log records the change set.

## 8. Open questions

1. Should REORDER/MOVE be exposed as a rule kind in v1 UI, or auto-derived (e.g. "sort rates ascending by price")? FEATURES lists reorder as MVP — default: expose `MOVE` with a position picker once 006 confirms the `move` operation's exact input shape.
2. Inline bulk-edit of priorities (text field) vs repeated up/down taps for large jumps — defer to 016.

## Standard scenarios

- **Uninstall → reinstall:** rules cascade; wizard re-seeds.
- **Plan downgrade:** nothing tier-gated in MVP.
- **Partial webhook failure/retry:** no webhooks; mutation retry semantics handled by fetcher + mirror sync state.
- **Large catalog:** condition fields referencing products use tag/SKU/vendor strings only — no catalog enumeration. Simulator's product picker (008) must paginate.
