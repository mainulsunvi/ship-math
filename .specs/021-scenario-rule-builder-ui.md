# 021 — Scenario Rule Builder UI

> Status: **approved for implementation, 2026-09-10** (user directive: "run the
> orchestrator and update the UI as we talked earlier; you can improvise the UI
> design"). Depends on: 005 (rule builder), 006 (Function), 008 (simulator +
> explain), 020 (shares the ActionEditor surface). Cross-refs: 011
> (collections/product groups), 014 (date/time), 015 (B2B) for the Advanced
> field catalog. Closes the "scenario builder" pattern from the competitor
> checklist (ShipX-style UI, FEATURES.md).

## 1. Problem statement

The current rule editor (`app/components/rules/RuleForm.tsx` +
`ConditionGroupEditor.tsx` + `ActionEditor.tsx`) is a sectioned FORM: IF
selects and THEN fields. Merchant-facing builders in this market use a
card-based SCENARIO layout (reference markup reviewed 2026-09-10):

1. **Scenario name** card (plain TextField).
2. **Field-tier picker** card: "Which condition would you like to use?" with
   two selectable cards — Basic vs Advanced — and the help line "Shopify
   limits how much data a single customization can access…". That limit is
   the Function input-query cost cap.
3. **Conditions** card: radios "All conditions must match" / "Any condition
   must match" / "None of the conditions match", then one summary CHIP per
   condition ("Cart · Quantity · equals 10"), each chip with edit + delete
   icon buttons, AND/OR badges between chips, "Add condition" button.
4. **THEN** card: "Set how to customize the rates if above conditions are
   met" — action chips ("Hide rates containing Express"), edit/delete,
   "Add action". MULTIPLE actions per branch.
5. **ELSE connector + card**: same chip list for "conditions are not met".

Capability gaps, not styling: **multi-action THEN**, **ELSE branch**, the
**NONE combinator**, **modal editors** (user directive 2026-09-10: "the
condition and Action Form should be in a modal"), and the **expanded
condition catalog** (user directive 2026-09-10, see §9 addendum).

## 2. Data model decision

Stored format (`app/lib/config-schema.ts`):

- `ConditionGroup.combinator` gains `"NONE"` — **root group only**
  (semantics: NOT(OR over leaves)); nested NONE is rejected in superRefine.
- The Prisma `action` column for HIDE/RENAME/MOVE rules stores a
  **FunctionRuleActions wrapper**: `{ actions: RuleAction[], elseActions:
  RuleAction[] }` (min 1 then-action; elseActions default `[]`). The
  repository's `JSON.stringify(parsed.action)` is untouched — the wrapper IS
  the action value.
  - Backward compat: a stored legacy single-action object (`{target, …}`)
    parses as `{ actions: [obj], elseActions: [] }` via z.preprocess; no
    migration run.
  - `CARRIER_RATE` keeps its single carrier payload and MUST NOT carry the
    wrapper (mutually exclusive in superRefine; carrier rules price, they do
    not customize).
- `ShippingRule.action` Prisma column stays JSON text (no schema change, no
  migration).

Wire format (function-config.ts): per rule `as: WireAction[]` (THEN) and
`ea: WireAction[]` (ELSE); the legacy `a` key still parses (preprocess →
`as:[a]`, fail-open in the extension parser). Combinator wire gains `"N"`.
Budget: ~+6 bytes per rule for empty ELSE; budget test extends to a 20-rule
config with else arrays (cap 9,500 bytes unchanged).

Evaluation (`rule-evaluation.ts`, shared pure / WASM-bundled):

- `RuleDecision` becomes `{ ruleId, kind, actions: WireAction[], branch:
  0 | 1 }`; consumers iterate the actions array in order.
- A rule that matches contributes THEN decisions; a rule that does NOT match
  and carries `ea` contributes ELSE decisions (empty `ea` = none,
  byte-identical to today).
- `stopOnMatch` halts only on a MATCH; an ELSE application never stops the
  pipeline.
- FIRST_MATCH: unchanged loop — break after the first MATCHING rule;
  non-matching rules still contribute ELSE before it, later rules are never
  evaluated.
- `evaluateConditionGroup` handles `o:"N"` as `!results.some(Boolean)`.

## 3. Admin GraphQL operations

None new for the builder itself. One optional read added to the sync path:
`shop { ianaTimezone }` cached in `Shop.prefs` (JSON column — no migration)
so date/time conditions evaluate in the shop's timezone (default UTC).

## 4. Access scopes required

None new.

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/lib/config-schema.ts` — actions/elseActions wrapper + NONE +
  preprocess + superRefine rules (root-only NONE, carrier exclusivity, rank
  checks walk both branches); `CONDITION_FIELDS` += `total`, `price`,
  `city`, `date`, `day_of_week`, `time_of_day` (§9).
- `app/lib/rule-form.ts` — parse the wrapper (and legacy single) for
  function kinds; 422 field errors for nested NONE and carrier+wrapper.
- `app/lib/rule-evaluation.ts` — branch-tagged decisions, ELSE emission,
  NONE combinator, new fact fields + evaluators (§9); purity-guarded.
- `app/lib/function-config.ts` — wire mapping `as`/`ea`/`cb:"N"` + budget;
  FUNCTION_UNSUPPORTED_FIELDS += date/day_of_week/time_of_day with an
  explicit exclusion reason; store `ianaTimezone` in prefs during sync.
- `extensions/delivery-customization/src/cart_delivery_run.graphql` — add
  `totalAmount`, line `cost.subtotalAmount`, `deliveryAddress.city`
  (26 → 29 of 30 cost points; arithmetic in §9).
- `extensions/delivery-customization/src/cart_delivery_run.ts` — iterate
  decision action arrays (both branches) into operations; parse `as`/`ea`
  (legacy `a` tolerated); facts += total/linePrices/city.
- `app/lib/store-rates.ts`, `app/lib/simulate.ts` — actions-array iteration
  via the shared matcher (§A4 parity by construction); facts += total/
  linePrices/city/nowLocal.
- `app/lib/rule-explain.ts` — traces name the branch ("else branch of rule
  X hid …").
- `app/components/rules/RuleForm.tsx` — card flow shell: Scenario card →
  Tier card → Conditions card → THEN card → ELSE connector + card → footer.
- `app/components/rules/ConditionGroupEditor.tsx` — chips + edit/delete +
  ALL/ANY/NONE radios at root (nested sub-groups stay, restyled, AND/OR
  only); depth cap 3 unchanged.
- `app/components/rules/ConditionModal.tsx` (new) — two-step modal: field
  catalog (searchable, categories incl. Date & time) → operator + typed
  value editor.
- `app/components/rules/ActionModal.tsx` (new) — ActionEditor content in a
  modal, opened by chip-edit / add-action.
- `app/components/rules/ActionEditor.tsx` — exports a chip summary helper.
- `app/styles/brand.css` — `.sm-rule-chip` chip row + `.sm-else-connector`
  (line + badge) styles, Polaris tokens, dark-scheme safe.
- `app/lib/__tests__/` — NONE semantics, ELSE emission, multi-action order,
  backward-compat parse, new-field evaluators, budget; Function fixtures:
  else-branch hides, multi-action; simulator parity test.
- `docs/help/rules.md` — scenario-builder walkthrough + new condition
  fields + lane notes, same run as code.

## 7. Acceptance criteria

1. Builder renders the five cards in order; the scenario name card feeds the
   existing rule name (no new column).
2. Condition chips show "Field · operator · value" summaries; edit reopens
   the ConditionModal; delete removes; AND/OR badges between chips match the
   selected combinator.
3. Root radios: ALL (AND), ANY (OR), NONE — NONE stores root combinator
   "NONE"; nested NONE → validation error, no row written.
4. NONE semantics unit test: leaves [a, b], facts matching only a → group
   does NOT match (NOT(OR)); empty leaves → matches (vacuous NOT(false)).
5. Multi-action THEN: one rule, actions [Hide Express, Rename Standard] →
   Function emits both operations; application order = array order; a second
   RENAME on the same option overwrites the first (pinned by test).
6. ELSE: rule with conditions unmet + elseActions [Hide pickup] → pickup
   hidden; same input through the simulator shows the identical result
   (parity test); trace labels the else branch.
7. stopOnMatch + ELSE: a matching stopOnMatch rule halts the pipeline; a
   non-matching rule's ELSE does not stop it (unit test).
8. Backward compat: every rule shape written before this spec (single
   `action`, no `ea`) parses and evaluates byte-identically — spec 006/008
   fixtures must stay green untouched.
9. CARRIER_RATE + wrapper in one payload → validation error; carrier editor
   UI stays a single action.
10. Budget: 20-rule config (5 with else arrays, 2 NONE groups) serializes
    ≤ 9,500 bytes.
11. UX writing rules hold (Title Case card headings, sentence-case buttons,
    no em/en-dashes, friendly labels, pluralization).
12. Tier card: Basic lists the supported field catalog (§9); Advanced is
    visibly marked "coming soon" per OQ-1 decision (no dead controls).

## 8. Open questions

1. ~~Advanced tier fields~~ — resolved 2026-09-10: Basic ships the §9
   catalog; Advanced stays "coming soon" (discount, attributes, product
   type, collection, purchase type, B2B). Zero query risk.
2. Nested NONE — root-only (recommended) — decided.
3. MOVE + cheapest-first clamp with multiple MOVEs — array-order application
   with the existing clamp, confirmed by review.

## 9. Addendum — 2026-09-10 user directives (scope of THIS run)

### 9.1 New condition fields

User: "add more product option … like Total, Subtotal, Price, Quantity,
Weight. And In Customer section Add City, State, Tag, Login Status. Also in
condition add date and time category. Add more option to condition, but do
not remove the old one."

Existing fields stay (subtotal, quantity, weight, sku, vendor, product_tag,
customer_tag, logged_in, destination_country, destination_province,
destination_postal). Added:

| Field | Stored key | Sections | Function lane | Carrier lane | Simulator |
|---|---|---|---|---|---|
| Cart total | `total` | Cart | YES (query) | yes (line sum) | yes |
| Item unit price | `price` | Product | YES (query) | yes (items[].price) | yes |
| Destination city | `city` | Customer | YES (query) | yes (destination.city) | yes |
| Date | `date` | Date & time | NO (no clock) | yes | yes |
| Day of week | `day_of_week` | Date & time | NO (no clock) | yes | yes |
| Time of day | `time_of_day` | Date & time | NO (no clock) | yes | yes |

- `destination_province` (State) and `destination_country` are surfaced in
  the Customer section of the picker per the user's grouping; the stored
  keys are unchanged.
- Semantics: `total` compares like subtotal; `price` uses ANY-line semantics
  (matches if any line's unit price satisfies the operator; `neq` = no line
  matches); `city` compares case-insensitively (=, !=, contains, in, not_in);
  `date` compares ISO `YYYY-MM-DD` lexicographically (=, !=, >, >=, <, <=);
  `day_of_week` uses in/not_in over MON..SUN; `time_of_day` compares
  zero-padded `HH:mm` strings (>, >=, <, <=).
- CartFacts gains optional `total?: number`, `linePrices?: number[]`,
  `city?: string | null`, `nowLocal?: string | null` (wall-clock
  `YYYY-MM-DDTHH:mm` in the shop timezone; undefined in the Function lane).
  Missing fact ⇒ condition fails closed (mirrors the missing-zone rule).
- Wire condition fields: `total`, `price`, `city`, `date`, `dow`, `tod`.

### 9.2 Function input-query budget (verified 2026-09-10 vs 2025-10 docs)

Verified unit costs: container 0 · leaf 1 · hasTags 3 (subselection free) ·
metafield 3 (fields on it free) · cap 30.

Current query = 26/30: subtotal 1 · buyerIdentity 4 · lines 8 ·
deliveryGroups 7 · 2 metafields 6.

Additions: `cart.cost.totalAmount.amount` +1 ·
`cart.lines.cost.subtotalAmount.amount` +1 ·
`deliveryGroups.deliveryAddress.city` +1 ⇒ **29/30**. No other field may be
added without re-verification. Unit-price = line subtotal ÷ quantity,
rounded to 2 decimals (money granularity; carrier uses cents ÷ 100, sim
uses the line price string — all three documented in tests).

### 9.3 Date & time lane rules (platform truth)

Checkout Functions are pure: **no clock** (verified in Functions docs). So
date/day_of_week/time_of_day conditions are evaluated ONLY in the carrier
callback and the simulator, both of which compute `nowLocal` from the
server clock converted into the shop timezone (`Shop.prefs.ianaTimezone`,
default UTC, refreshed at sync). A function-kind rule using those fields is
EXCLUDED from the checkout mirror with the reason "uses date and time
conditions that the checkout Function cannot evaluate (no clock) — the rule
still runs in the carrier lane and the simulator". The UI shows the same
note in the Date & time picker section. Old rules never contain these
fields (new field keys), so no back-compat surface.

### 9.4 Modal editors

Condition and Action forms open in Polaris Modals (user directive):
chip-edit and add buttons open `ConditionModal` / `ActionModal`; chips carry
one-line summaries. Zone flows stay unchanged.

## Standard scenarios

- **Uninstall/reinstall:** rules cascade unchanged; old/new JSON shapes both
  tolerated by the parser.
- **Plan downgrade:** function-lane only — NONE, multi-action, ELSE, and the
  new query-backed fields work on Basic with no CCS; date/time fields are
  carrier-lane only (labeled in UI).
- **Partial webhook failure/retry:** no new webhooks.
- **Large catalog:** no catalog reads; chip summaries are client-side
  renders of stored JSON.
