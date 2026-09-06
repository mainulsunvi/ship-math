# Plan — 009: AI Setup Assistant

Spec: `.specs/009-ai-setup-assistant.md` · Depends on: 003 (wizard entry),
004/005 (mutations + diff surfaces). Architecture: §A6 (boundaries — read first).
Estimate: 2–3 days. **Env needed:** `AI_PROVIDER`, `AI_MODEL_SMALL`,
`AI_MODEL_LARGE`, provider key — request from the human before starting.

## Task 1 — Provider abstraction (`app/lib/ai/provider.ts`)

```ts
export interface CompletionRequest { model: "small" | "large"; system: string; user: string; maxTokens?: number }
export async function completeJson<T>(req: CompletionRequest, schema: z.ZodType<T>): Promise<T>;
```

- env-resolved provider (fetch-based; start with one provider, keep the interface).
- JSON-mode request → parse → `schema.safeParse`; one repair round-trip appending
  the validation error; else throw `ProposalParseError` (friendly, retryable).
- `AiUsageDay` increment per provider call: `incrementAiUsage(shopId)` upsert
  (`onConflict: shopId+day`) — metering counts CALLS including repairs (§A6).

## Task 2 — Proposal schema + prompts (`app/lib/ai/proposal.ts`)

```ts
export const ProposalSchema = z.object({
  zones: z.array(StoredZoneSchema-ish),   // reuse config-schema stored shapes
  rules: z.array(StoredRuleSchema),        // incl. lane-capability refine (§A3)
  notes: z.array(z.string()),
});
export function buildProposalPrompt(intent: string, currentConfigSummary: ConfigSummary): { system: string; user: string };
```

`ConfigSummary` = zone/rule names + counts + schema excerpt — **configuration-shaped
only** (criterion 8 asserts: prompt builder input type has no customer fields, by
construction). Destructive ops (delete) allowed but flagged (OQ-2 default).

## Task 3 — Postal bulk parsing (`app/lib/ai/parse-postal.ts`, small model)

```ts
export async function parsePostalCodes(shopId: string, freeText: string): Promise<{ rules: PostalRule[]; rejected: Array<{ raw: string; reason: string }> }>;
```

Model normalizes to EXACT/PREFIX/RANGE/PARTIAL; every candidate re-validated
client-side with `validatePartialPattern` (004) — **validation is code's, not the
model's**; failures land in `rejected`, never dropped silently (criterion 6).

## Task 4 — Apply with audit (`app/lib/ai/apply.ts`)

```ts
export async function applyProposal(shopId: string, accepted: { zones: boolean; rules: boolean }, proposal: Proposal): Promise<ApplyResult>;
```

- Routes through the 004/005 repositories (never direct Prisma from model output).
- Before/after snapshots → single AuditLog row per accepted section, `actor: "AI"`.
- `revertAiApply(auditLogId)`: restores the snapshot via the same repos + re-mirror
  (round-trip unit test — criterion 5).
- After apply: `ensureFunctionOwner` + `pushFunctionConfig` (same orchestration as
  manual mutations).

## Task 5 — Route + UI

- `app/routes/app.ai.tsx` — JSON action (fetcher target), intents:
  `intent` (→ proposal draft), `parse` (postal), `apply`, `revert`. Every intent
  checks the AiUsageDay cap first (default 50/day, `AI_DAILY_CAP` tunable) →
  429-shaped json `{ capped: true, used, cap }`.
- `AssistantModal.tsx` — shortcuts (Create a zone / Create rates / Full setup) +
  free text + visible disclaimer ("AI can make mistakes — review changes before
  applying").
- `DiffPreview.tsx` — sectioned (zones / rules) with per-section accept checkboxes
  (partial acceptance), destructive entries in critical style + extra confirm
  click (criteria 3–4).
- `UsageMeter.tsx` — `used / cap` for the day.
- Wizard integration: replace 003's placeholder with the real modal.

## Acceptance mapping

1 → intent fixtures · 2 → stubbed-invalid-model test · 3–4 → DiffPreview behavior ·
5 → revert round-trip · 6 → messy-paste fixture (2 junk lines → 2 rejects) ·
7 → 51st request capped · 8 → prompt-builder type test · 9 → entry points + wizard
non-blocking.

## Do NOT

- Never send customer data, request logs, or PII in prompts (§A6; 018 re-specifies
  log-input usage later).
- Never write model output to Prisma directly — repos + validation only.
- Never hardcode a provider or model name in code — env only.
- Do not meter repairs as free — each provider call counts.
