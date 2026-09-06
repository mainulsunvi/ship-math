# 009 — AI Setup Assistant

## 1. Problem statement

INSTRUCTION.md requires an in-wizard "configure with AI" option and AI in the MVP.
FEATURES §5 validates the direction: merchants describe intent ("Free shipping over
$75 in Ontario, $12 flat everywhere else in Canada, don't ship to the territories")
and get a structured, previewable configuration. The assistant must never write to
the database from model output — it proposes; the merchant approves through a diff
preview (FEATURES §5.1, §5.3 guardrails).

## 2. Data model decision

No schema change. `AiUsageDay` (002) meters requests; `AuditLog` rows with
`actor: "AI"` record every applied change set for one-click rollback (rollback UI
minimal in MVP: revert to the snapshot before the AI apply).

- Read path: assistant reads current zones/rules (for diffing) and the rule schema
  (Zod, 002) — **never customer data; no PII leaves the app** (guardrail §5.3).
- Write path: merchant confirms diff → standard rule/zone mutations (005 actions) →
  audit row tagged AI with before/after JSON.

**Decisions:**
- **Model routing (FEATURES §5.4):** small/fast model for parsing + postal-code
  normalization; larger model only for full-setup conversations. Provider via env
  (`AI_PROVIDER`, `AI_MODEL_SMALL`, `AI_MODEL_LARGE`, keys) — no provider lock-in in code.
- **Contract:** the model returns JSON constrained to a proposal schema
  (`{ zones: […], rules: […], notes: string[] }`); output is validated with Zod
  against `FunctionConfig`-adjacent shapes; invalid → one repair round-trip → else a
  friendly failure, nothing rendered as applicable config.
- **Bulk postal parsing:** free-text paste → model normalizes to
  EXACT/PREFIX/RANGE/PARTIAL rules validated by `validatePartialPattern` (004);
  unparseable entries are returned flagged for manual review, never silently dropped.
- **Preview/diff:** modal lists created/updated/deleted zones+rules with destructive
  changes (delete/overwrite) in a distinct critical style; explicit confirm required;
  partial acceptance ("apply zones, skip rates") supported via per-section checkboxes.
- **Entry points:** wizard step (003), persistent "Set up with AI" button on the Rules
  page, plus guided shortcuts (Create a zone / Create rates / Full setup) and free text.
- **Cap:** default 50 requests/shop/day (env-tunable), enforced via `AiUsageDay`,
  quietly enforced with a soft in-app notice when reached (guardrail §5.4).
- Visible disclaimer matching platform convention ("AI can make mistakes — review
  changes before applying").

## 3. Admin GraphQL operations

None. All application happens through existing rule/zone actions.

## 4. Access scopes required

None beyond 001.

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/lib/ai/provider.ts` — `completeJson(model, messages)` declaration abstracting the provider; env-configured.
- `app/lib/ai/proposal.ts` — Zod proposal schema + `buildProposalPrompt(intent, currentConfigSummary)`.
- `app/lib/ai/parse-postal.ts` — `parsePostalCodes(freeText)` → `{ rules, rejected: { raw, reason }[] }` (small model).
- `app/lib/ai/apply.ts` — `applyProposal(shopId, acceptedSections)` → reuse 005 mutations; writes AI audit rows + rollback snapshot.
- `app/routes/app.ai.tsx` — JSON action route for assistant calls (fetcher target): `intent`, `parse`, `apply` intents.
- `app/components/ai/AssistantModal.tsx` — chat/entry UI with shortcuts + free text + disclaimer.
- `app/components/ai/DiffPreview.tsx` — sectioned diff with destructive highlighting + per-section accept checkboxes + confirm.
- `app/components/ai/UsageMeter.tsx` — remaining-requests indicator.
- Wizard integration: `StepRates` (003) gains "Set up with AI" launching `AssistantModal`.

## 7. Acceptance criteria

1. Sample intents from FEATURES §5.1 produce valid proposals (Zod-passing) for zone + rate rules; the diff modal renders exactly what will be created/updated/deleted.
2. Model output failing schema is repaired once or rejected gracefully — no partial config is ever written directly from model output (asserted by test with a stubbed invalid model).
3. Partial acceptance applies only checked sections; audit rows are per-section.
4. Destructive entries (rule deletion) render in critical style and require an extra confirm click.
5. Every applied AI change writes an `AuditLog` row with `actor: "AI"`, before/after JSON; "Revert" restores the snapshot (unit test round-trip).
6. Postal paste fixture (messy spreadsheet excerpt incl. UK/CA partials + 2 junk lines) yields valid rules + 2 flagged rejects, none dropped silently.
7. 51st request in a day returns the capped response; meter shows 50/50.
8. No PII in any outbound prompt (test asserts prompt builder receives config-shaped data only; customer fields absent by construction).
9. AI entry points exist in wizard and Rules page; declining AI never blocks manual flow (003 criterion 5 unaffected).

## 8. Open questions

1. Provider selection + key custody (env vars in hosting; who owns the account) — needs a decision before 010 submission.
2. Should proposals support DELETE of existing rules in MVP, or only CREATE/UPDATE (safer)? Default: allow, but behind the extra confirm; product call pending.
3. Rollback scope: snapshot-revert per apply, or full history browser (016)? MVP = per-apply revert.

## Standard scenarios

- **Uninstall → reinstall:** usage/audit cascade; assistant starts fresh with zero quota consumed.
- **Plan downgrade:** AI features are plan-independent in MVP (cost control is the quota); if a future tier meters AI, downgrade paths defined in 016/019.
- **Partial webhook failure/retry:** no webhooks; provider call failures return a retryable error to the modal, nothing persisted.
- **Large catalog:** prompts include configuration summaries only — bounded by rule/zone counts, not catalog size; product-specific intents are resolved against paginated product search when needed (defer; editor covers manual).
