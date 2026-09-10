# 020 — Rate Visibility Selectors

> Status: **future / post-MVP, ready to plan**. Depends on: 005 (rule builder),
> 006 (Function), 008 (simulator parity). Closes the competitor gap in
> FEATURES.md "SMART Shipping Rates": *Show cheapest or highest rate only*, plus
> a first-class "show only specific rates" affordance. Function-lane only: every
> feature here works on the Basic plan with no CCS requirement.

## 1. Problem statement

ShipMath's HIDE/RENAME/MOVE rules target delivery options by method type or by
title substring (`OptionTarget { method, titleContains }` in
`app/lib/config-schema.ts`, matched per-option by `optionMatchesTarget` in
`app/lib/rule-evaluation.ts`). Three merchant-visible behaviors from the
competitor checklist are missing because targeting has no price awareness and
no inverse mode:

1. **Show only the cheapest rate** (hide everything else).
2. **Show only the most expensive rate** (hide everything else).
3. **Show only specific rates** (hide everything except e.g. anything named
   "Standard"). Today this is only achievable by enumerating every unwanted
   rate in separate Hide rules: tedious, and it silently breaks when Shopify
   adds a new rate.

All three are one mechanism: **inverse targeting** ("hide all EXCEPT the
match") plus a **price-rank selector** ("the match = cheapest / most expensive
option in the delivery group"). Both are computable in the Delivery
Customization Function because checkout delivery options carry cost; no CCS, no
carrier lane involvement, no new scopes.

## 2. Data model decision

Stored format (`app/lib/config-schema.ts`):

- `OptionTargetSchema` gains two optional fields:
  - `rank: z.enum(["CHEAPEST", "MOST_EXPENSIVE"]).optional()`
  - `invert: z.boolean().optional()`
- `ActionSchema` is unchanged (it already embeds `target`).
- `StoredRuleSchema.superRefine`:
  - `rank` is valid on HIDE only in this spec (RENAME/MOVE rank is OQ-2).
  - A target with `rank` must NOT also carry `method`/`titleContains`
    (mutually exclusive matchers; reject with a field error, never silently
    drop one).

Wire format (`WireAction`, compact keys, budget ~9,500 bytes — two optional
short keys ≈ +10 bytes per rule, negligible):

- `rk?: "C" | "E"` (rank cheapest / most expensive)
- `iv?: 0 | 1` (invert)

`toWireConditionGroup`'s sibling action mapper in `app/lib/function-config.ts`
translates both. Old configs without the keys parse unchanged (fail-open,
backward compatible).

Option facts (`app/lib/rule-evaluation.ts`):

- `DeliveryOptionFacts` gains `cost?: number | null` (decimal number in shop
  currency; null = unknown, ranks last on ASC / first on DESC).

## 3. Admin GraphQL operations

None. (Rates arrive through the checkout Function input and the simulator's
existing delivery-profiles query; nothing new is queried from Admin.)

## 4. Access scopes required

None new.

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/lib/config-schema.ts` — rank + invert on OptionTarget, superRefine rules.
- `app/lib/rule-evaluation.ts` (SHARED PURE — bundled into the Function WASM):
  - `resolveRankHandles(options: DeliveryOptionFacts[]): { cheapest: string | null; mostExpensive: string | null }`
    — deterministic: ties break by first occurrence in input order.
  - `optionMatchesTarget(action, option, ranks?)` — optional third param (older
    two-arg calls keep working): rank actions match only the resolved handle;
    `iv` inverts the final verdict. Rank without a ranks argument = no match
    (fail-closed, mirrors the missing-zone rule).
- `extensions/delivery-customization/src/cart_delivery_run.graphql` —
  `deliveryOptions { ... cost { amount } }`. **Cost budget: current query
  estimates ≈ 29/30 points; `cost` is a container (0) + `amount` leaf (1) →
  30/30 exactly.** Must be verified against the live query-cost API before
  merge; see OQ-1 for the fallback.
- `extensions/delivery-customization/src/cart_delivery_run.ts` — build
  `ranks` per delivery group (one `resolveRankHandles` call per group), pass
  `cost: Number(option.cost?.amount) || null` into option facts, forward
  `ranks` into `optionMatchesTarget`. HIDE remains the only consumer of rank.
- `app/lib/function-config.ts` — wire mapping for `rk`/`iv`.
- `app/lib/store-rates.ts` (simulator parity) — the function-op application
  path already loops options with prices; feed `cost` into the same
  `DeliveryOptionFacts` and the same `resolveRankHandles` so preview and
  checkout cannot drift (§A4 parity by construction).
- `app/lib/rule-explain.ts` — explain traces name the selector ("hidden by
  Show only cheapest: kept <title>", "hidden by Show only except 'Express'").
- `app/components/rules/ActionEditor.tsx` — HIDE action gains a targeting
  mode Select (UX rule: friendly labels, never enums):
  1. "Hide matching rates" (current behavior)
  2. "Show only matching rates" (sets invert; label reads as SHOW — merchants
     think in "show", the engine stores "hide except")
  3. "Show only the cheapest rate" (rank CHEAPEST + invert)
  4. "Show only the most expensive rate" (rank MOST_EXPENSIVE + invert)
  5. "Hide the cheapest rate" / "Hide the most expensive rate" (rank without
     invert — offered under a "More" affordance; legitimate: suppress the
     cheapest competitor rate)
  Mode 1–2 combine with the existing method/titleContains pickers; modes 3–6
  disable them (mutual exclusion enforced in the form, not just superRefine).
- `app/components/rules/RuleForm.tsx` — pass-through only (action payload is
  opaque to the form shell).
- `docs/help/rules.md` — new "Show only the cheapest or a specific rate"
  section, future tense, same run as code (binding doc rule).

## 7. Acceptance criteria

1. **Cheapest-only**: delivery group fixture with rates 8, 5, 15 → a
   "Show only the cheapest rate" HIDE rule leaves exactly the 5; the Function
   emits two `deliveryOptionHide` operations and the simulator's combined
   preview shows the identical survivor set (parity test asserts both).
2. **Most-expensive-only**: same fixture leaves exactly the 15.
3. **Show-only-named**: "Show only rates containing Standard" over
   {Standard, Express, Local pickup} hides Express + Local pickup, keeps
   Standard; a rate added later that does NOT contain "Standard" is hidden
   automatically (fixture adds a fourth rate post-sync — no rule edit needed).
4. **Tie-break determinism**: two rates both 5.00 → the FIRST in the group's
   option order survives; unit test pins the order.
5. **Unknown cost**: an option whose cost is null never counts as cheapest
   (fail-closed); unit test.
6. **Mutual exclusion validation**: rank + titleContains in one target →
   422-style field error through `parseRuleForm`, no row written.
7. **Backward compatibility**: configs pushed before this spec (no `rk`/`iv`)
   parse and behave identically — fixture from spec 006 suite must stay green
   untouched.
8. **Byte budget**: a 20-rule config with two rank rules serializes ≤ 9,500
   bytes (budget test extension).
9. **Input-query cost**: the Function input query with `cost { amount }` is
   accepted by the live query-cost check (≤ 30). If it exceeds, OQ-1 fallback
   decision is recorded here before merge.
10. **Explain traces**: simulator trace for criteria 1 and 3 renders the
    merchant-readable selector description (rule-explain test).
11. Purity guard entries for any new pure module (none expected — changes land
    in existing guarded files).

## 8. Open questions

1. **Input-query cost headroom.** The estimate says 29/30 today; +1 for
   `amount` lands exactly at 30/30 with zero slack for any future field. If
   the real API reports over-cap, the fallback options are (a) drop
   `deliveryMethodType` (-1) and restrict method targeting to the simulator
   only — NOT acceptable, or (b) rank by cost only when present and accept
   that stores on legacy rate setups (no cost exposure) fail closed. Decide
   with a live measurement before implementation; do not guess.
2. **Rank on RENAME/MOVE?** "Rename the cheapest rate" and "Move the cheapest
   rate to the top" fall out of the mechanism for free, but widen the test
   matrix and invite App Store cheapest-first-selection scrutiny (clamping
   already exists for MOVE). Default: defer to a follow-up; implementer
   confirms with the human before enabling.
3. **Multiple rank rules in one config** (e.g. show-only-cheapest AND
   hide-the-most-expensive): evaluation order is priority order today;
   cheapest-survivor math must be computed against the ORIGINAL option list,
   not the already-hidden one (a hidden option cannot be the "cheapest
   shown"). Confirm this semantic in review.

## Standard scenarios

- **Uninstall/reinstall:** no new persisted state beyond rule JSON; rules
  cascade with the shop row exactly as today.
- **Plan downgrade:** function-lane only — every selector here works on Basic
  with no CCS; downgrade changes nothing (this spec exists partly to widen the
  no-CCS gap over competitors).
- **Partial webhook failure/retry:** no new webhooks.
- **Large catalog:** no catalog reads; option costs come from checkout's own
  delivery-option payload and the simulator's existing paginated
  delivery-profiles query (2/request, unchanged).
