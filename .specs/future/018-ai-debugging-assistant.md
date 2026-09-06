# 018 — AI Debugging Assistant (Reverse Mode)

> Status: **future / post-MVP (differentiated direction)**. Depends on: 008 (simulator + request log), 009 (AI provider plumbing).

## 1. Problem statement

"Zapiet uses AI for setup. Nobody is using it for debugging, which is where the
support tickets actually are" (FEATURES §5.2). Reverse mode answers "Why did this
customer see $45 shipping?" and "Why is no rate showing for this cart?" by reading
the rate request log, identifying the matched rule, and explaining the calculation
in plain language — then suggests and offers to apply the specific fix.

## 2. Data model decision

No new tables. Reads `RequestLog` (+ trace JSON from 008) and config; applies fixes
through the 009 apply funnel (same validation, diff, confirm, AI-tagged audit).

## 3. Admin GraphQL operations

None (order lookups by id for context, reusing 017's `read_orders` if that spec shipped).

## 4. Access scopes required

None new (beyond whatever 017 introduced).

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/lib/ai/debug.ts` — `explainRequest(requestLogId)`: builds a factsheet (matched rules, failed conditions, zone gates, rate math) and asks the model to explain in plain language; model never re-computes matches — it narrates verified facts.
- `app/components/ai/DebugPanel.tsx` — log-row "Why?" action → explanation modal + suggested fix + "Apply fix" (routes into 009's `DiffPreview`).
- `app/routes/app.ai.tsx` — extends the action route with `explain` and `suggest-fix` intents.
- Quota: shared with 009's `AiUsageDay` cap.

## 7. Acceptance criteria

1. Given a seeded request log with a matched tier rule, `explainRequest` output names the rule, the band, and each math step in order — verified against the stored trace (facts must match, not just sound right).
2. A zero-rate case explains exactly which condition/gate failed (trace-driven).
3. Suggested fixes render as proposals through the standard diff + confirm flow — never direct writes.
4. Model narration is tested against prompt-injection fixtures (malicious rule names) — output escaped, no instruction-following from data strings.
5. Shares the daily quota; capped response identical to 009 criterion 7.
6. No PII in prompts (customer destination is reduced to zone-match facts, not raw address).

## 8. Open questions

1. Should explanations localize (merchant locale) at v1 or English-only?
2. Suggest-and-apply scope: only rule-parameter tweaks, or also zone edits? Default: parameter tweaks first.

## Standard scenarios

- **Uninstall/reinstall:** nothing persists (logs cascade).
- **Plan downgrade:** AI quota/features gated with 009's tiering when tiers split.
- **Partial webhook failure/retry:** none.
- **Large catalog:** factsheets are config+log-shaped; size bounded by rules and trace depth.
