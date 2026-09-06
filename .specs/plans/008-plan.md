# Plan — 008: Test Mode, Rate Simulator & Request Log

Spec: `.specs/008-test-mode-simulator-log.md` · Depends on: 007 (computeRates),
004/005 (editors). Architecture: §A4 (parity by construction, purity boundary,
explainRules), §A3 (log shape). Estimate: 2 days.

## Task 1 — Explain traces (`app/lib/rule-explain.ts`, app-side pure)

```ts
export interface RuleTrace { ruleId: string; ruleName: string; matched: boolean; failedConditionPath?: string; zoneGate?: "country" | "province" | "postal"; }
export function explainRules(config: WireConfig, facts: CartFacts, destination: Destination): RuleTrace[];
export function traceCarrierRules(rules: CarrierRule[], zones: WireZone[], cart: CarrierCartContext): RuleTrace[];
```

Wrap `evaluateConditionGroup` with a path collector (`c.n[2].n[0]`-style paths);
zone failures reuse `explainZoneMatch` (already in zone-matching.ts). **App-side
only** — never import from the Function entry (§A4 purity boundary keeps WASM lean).

Verify: unit tests — failing AND path identifies the exact condition; zone miss
identifies the gate (country/province/postal).

## Task 2 — Simulator core (`app/lib/simulate.ts`)

```ts
export interface SimInput { lines: SimLine[]; destination: {country, province, postal}; loggedIn: boolean; customerTags: string[] }
export interface SimulationResult { rates: ComputedRate[]; functionOperations: unknown[]; traces: RuleTrace[]; wireBytes: number }
export async function simulateRun(shopDomain: string, input: SimInput): Promise<SimulationResult>;
```

**Parity by construction (§A4):**
1. `buildFunctionConfig(shopId)` → the SAME wire config checkout reads →
   `explainRules` for function-kind traces; `evaluateRules` for the operations the
   Function WOULD emit (shown, not applied).
2. Enabled CARRIER_RATE rules from Prisma → `computeRates` (+ `traceCarrierRules`).
3. Facts built identically to the Function's `buildFacts` (weight in grams,
   subtotal decimal) — extract the shared facts builder if drift is possible.
4. Persist `RequestLog(SIMULATION)` with input snapshot + traces (fire-and-forget
   not needed here — synchronous, user-facing).

Verify: parity test — fixtures produce byte-identical `rates` to the engine's unit
tests; overlapping-rules fixture shows both rules + winner per evaluationMode
(criterion 1); out-of-zone fixture returns "no rates — no zone matched" with the
country gate named (criterion 2).

## Task 3 — Simulator UI (`app/components/simulator/*`)

- `SimulatorModal.tsx` — launched from Rules page (enable the button added in
  004/005 Task 4) and Logs page. Two-pane: input / result.
- `CartBuilder.tsx` — line editor (title, price, weight, qty, sku, vendor, product
  tags) reusing `ConditionRow` value-input patterns; subtotal auto-derived.
- `DestinationForm.tsx` — country/province/postal reusing zone field components.
- `TraceResult.tsx` — per rule: pass/fail badge, failed path, zone gate; returned
  rates table; would-be Function operations list; wire bytes used.
- Wire target: `app._index` action intent `simulate` → `simulateRun` → json result.

## Task 4 — Log viewer (`app/routes/app.logs.tsx`)

- Loader: paginated 50/page newest-first; `?source=` filter (index
  `@@index([shopId, source, createdAt])` exists); expandable rows via Polaris
  IndexTable: input snapshot, matched rules (name + order), rates, latencyMs.
- Nav: add "Logs" tab to `ShipMathNav`.
- `app/lib/prune-logs.ts` — `pruneRequestLogs(shopId)` delete `createdAt <
  now-30d`; called 1-in-20 inserts (carrier route already does; simulator calls it
  on the same cadence).

Verify (criteria 5–6): pagination + filter behavior; seeded 31-day-old rows vanish
after a new insert.

## Task 5 — Test-mode wiring audit

Test mode already: mirror carries `t` (Function pass-through — fixture
`test-mode.json`), carrier gate returns empty (007), go-live blocked (007 Task 6).
This task verifies criterion 7 end-to-end and adds the missing piece: simulator is
unaffected by test mode (it's the preview surface) — document in the modal copy.

## Acceptance mapping

1–2 → Task 1/2 tests · 3 → parity test · 4 → SIMULATION rows visible · 5–6 →
Task 4 · 7 → Task 5 · 8 → manual script (feeds 010's reviewer instructions).

## Do NOT

- Do not invent a second evaluation path — simulator must call the production
  modules (parity is the selling point).
- Do not put explain code into `rule-evaluation.ts` (WASM boundary — §A4).
- Do not prune synchronously on the hot callback path beyond the 1-in-20 cadence.
