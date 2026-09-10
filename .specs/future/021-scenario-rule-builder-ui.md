# 021 — Scenario Rule Builder UI

> Status: **future / post-MVP, ready to plan**. Depends on: 005 (rule builder),
> 006 (Function), 008 (simulator + explain), 020 (shares the ActionEditor
> surface). Cross-refs: 011 (collections/product groups), 014 (date/time),
> 015 (B2B) for the Advanced field catalog. Closes the "scenario builder"
> pattern from the competitor checklist (ShipX-style UI, FEATURES.md).

## 1. Problem statement

The current rule editor (`app/components/rules/RuleForm.tsx` +
`ConditionGroupEditor.tsx` + `ActionEditor.tsx`) is a sectioned FORM: IF
selects and THEN fields. Merchant-facing builders in this market use a
card-based SCENARIO layout (reference markup reviewed 2026-09-10):

1. **Scenario name** card (plain TextField).
2. **Field-tier picker** card: "Which condition would you like to use?" with
   two selectable cards — Basic vs Advanced — and the help line "Shopify
   limits how much data a single customization can access…". That limit is
   the Function input-query cost cap (verified: our query ≈ 29/30 points;
   020 lands exactly 30/30).
3. **Conditions** card: radios "All conditions must match" / "Any condition
   must match" / "None of the conditions match", then one summary CHIP per
   condition ("Cart · Quantity · equals 10"), each chip with edit + delete
   icon buttons, AND/OR badges between chips, "Add condition" button.
4. **THEN** card: "Set how to customize the rates if above conditions are
   met" — action chips ("Show all rates", "Rename rate name: Hello → Hello
   World"), edit/delete, "Add action". MULTIPLE actions per branch.
5. **ELSE connector + card**: same chip list for "conditions are not met".

Three of those are capability gaps, not styling: **multi-action THEN**,
**ELSE branch**, and the **NONE combinator**. The rest is a presentation
layer over structures we already have. All function-lane: works on Basic,
no CCS.

## 2. Data model decision

Stored format (`app/lib/config-schema.ts`):

- `ConditionGroup.combinator` gains `"NONE"` — **root group only**
  (semantics: NOT(OR over leaves)); nested NONE is rejected in superRefine.
- Function kinds (HIDE/RENAME/MOVE) move from single `action` to:
  - `actions: z.array(ActionSchema).min(1)` — THEN branch
  - `elseActions: z.array(ActionSchema).default([])` — ELSE branch
  - Backward compat: a stored rule with the old single `action` object
    parses as `actions: [action]` (preprocess in schema; no migration run).
  - `CARRIER_RATE` keeps single `action` and MUST NOT carry `actions` /
    `elseActions` (mutually exclusive in superRefine; carrier rules price,
    they do not customize).
- `ShippingRule.action` Prisma column stores the new JSON shape verbatim
  (no schema change, no migration).

Wire format (function-config.ts): per rule add `as: WireAction[]` (THEN) and
`ea: WireAction[]` (ELSE); old `a` key still parses (fail-open). Combinator
wire gains `"N"`. Byte cost: ~+6 bytes per rule for empty ELSE; budget test
extends to a 20-rule config with else arrays (cap 9,500 bytes unchanged).

Evaluation (`rule-evaluation.ts`, shared pure / WASM-bundled):

- A rule that matches contributes THEN decisions; a rule that does NOT match
  contributes ELSE decisions (empty `ea` = none, byte-identical to today).
- `decisions` entries carry the branch (`b: 0 | 1`) so traces and the
  Function can label them.
- `stopOnMatch` halts only on a MATCH; an ELSE application never stops the
  pipeline.
- FIRST_MATCH: unchanged loop — break after the first matching rule; later
  rules are never evaluated, so their ELSE never fires (same semantics as
  today's break; documented, not re-decided).

## 3. Admin GraphQL operations

None.

## 4. Access scopes required

None new.

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/lib/config-schema.ts` — actions/elseActions/NONE + superRefine rules
  (root-only NONE, carrier exclusivity, old-shape preprocess).
- `app/lib/rule-form.ts` — accept the new payload shape; 422 field errors
  for nested NONE and carrier+actions.
- `app/lib/rule-evaluation.ts` — branch-tagged decisions, ELSE emission,
  NONE combinator (pure; purity-guarded).
- `app/lib/function-config.ts` — wire mapping `as`/`ea`/`cb:"N"` + budget.
- `extensions/delivery-customization/src/cart_delivery_run.ts` — iterate
  decision.action arrays (both branches) into operations.
- `app/lib/store-rates.ts`, `app/lib/simulate.ts` — same array iteration via
  the shared matcher (§A4 parity by construction).
- `app/lib/rule-explain.ts` — traces name the branch ("else branch of rule
  X hid …").
- `app/components/rules/RuleForm.tsx` — card flow shell: Name card →
  Tier card → Conditions card → THEN card → ELSE connector + card → footer.
- `app/components/rules/ConditionGroupEditor.tsx` — chips + edit/delete +
  ALL/ANY/NONE radios at root (nested sub-groups stay, restyled, AND/OR
  only); depth cap 3 unchanged.
- `app/components/rules/ActionEditor.tsx` — becomes the chip EDITOR
  (popover/modal opened from a chip); gains 020's selector modes; chips
  render one-line summaries ("Hide rates containing Express").
- `app/styles/brand.css` — `.sm-rule-card` chip row + `.sm-else-connector`
  (line + badge) styles, Polaris tokens, dark-scheme safe.
- `app/lib/__tests__/` — NONE semantics, ELSE emission, multi-action order,
  backward-compat parse, budget; Function fixture: else-branch hides;
  simulator parity test.
- `docs/help/rules.md` — scenario-builder walkthrough, same run as code.

## 7. Acceptance criteria

1. Builder renders the five cards in order; scenario name card feeds the
   existing rule name (no new column).
2. Condition chips show "Group · Field · operator value" summaries; edit
   reopens the row editor; delete removes; AND/OR badges between chips match
   the selected combinator.
3. Root radios: ALL (AND), ANY (OR), NONE — NONE stores root combinator
   "NONE"; nested NONE → 422 field error, no row written.
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
9. CARRIER_RATE + `actions` in one payload → validation error; carrier
   editor UI unchanged (single action).
10. Budget: 20-rule config (5 with else arrays, 2 NONE groups) serializes
    ≤ 9,500 bytes.
11. UX writing rules hold (Title Case card headings, sentence-case buttons,
    no em/en-dashes, friendly labels, pluralization).
12. Tier card: Basic lists exactly our 11 supported fields; Advanced is
    visibly marked "coming soon" per OQ-1 decision (no dead controls).

## 8. Open questions

1. **Advanced tier fields** (discount, cart attributes, product type,
   collection, product property, purchase type, order history, B2B company,
   date & time): none exist in our fixed input query, which is ≈29/30 cost
   points (verified) and 30/30 after 020. Options: (a) ship Basic only +
   "coming soon" Advanced card — honest, zero risk (RECOMMENDED default);
   (b) ship a second Function variant with an advanced query and activate
   per shop — doubles extension surface; (c) trim existing query fields —
   NOT acceptable (breaks live rules). The catalog itself is specced in
   011/014/015; human decides before implementation.
2. **Nested NONE**: root-only (recommended) or full De Morgan expansion for
   nested groups? Root-only keeps evaluation trivially explainable.
3. **MOVE + cheapest-first clamp with multiple MOVEs**: array-order
   application with the existing clamp is the default; confirm in review.

## Standard scenarios

- **Uninstall/reinstall:** rules cascade unchanged; old/new JSON shapes both
  tolerated by the parser.
- **Plan downgrade:** function-lane only — NONE, multi-action, and ELSE all
  work on Basic with no CCS; carrier rules unchanged.
- **Partial webhook failure/retry:** no new webhooks.
- **Large catalog:** no catalog reads; chip summaries are client-side
  renders of stored JSON.
