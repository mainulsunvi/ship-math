# 008 — Test Mode, Rate Simulator & Request Log

## 1. Problem statement

"Every competitor ships test mode, and your Shopify reviewer will use it" (FEATURES
§3.5). The simulator and request log are the primary support-ticket deflectors and
the substrate for the AI debugging direction (018). This spec wires the three trust
features: a shop-level test mode, a cart+address simulator that explains which rules
fired and why, and a request log of recent rate calls.

## 2. Data model decision

No schema change: `Shop.testMode` (002), `RequestLog` rows (002). Simulator runs are
logged as `source: SIMULATION` — same table, filterable.

- Read path: log viewer loads `RequestLog` paginated (50/page, newest first) with a
  source filter; simulator loads rules/zones + logs the run.
- Write path: simulator action → evaluate with the **same engine modules** the carrier
  endpoint uses (`computeRates` 007, `evaluateConditions`/`orderRules` 005,
  `matchesZone`/`explainZoneMatch` 004) → persist a `SIMULATION` log row.

**Decisions:**
- Simulator input mirrors the carrier callback's cart shape (items with price,
  weight, quantity, tag/SKU/vendor; destination country/province/postal; logged-in
  toggle; subtotal auto-derived).
- Output shows, per returned rate: the winning rule, and for every evaluated rule a
  pass/fail trace with the failed condition path (via `evaluateConditions`'
  `failedAt` and `explainZoneMatch`'s gate breakdown).
- Log retention: 30 days, pruned opportunistically on insert (1/20 inserts triggers a
  delete-older-than sweep for that shop) — no cron dependency for MVP.
- Test mode semantics (shared with 006/007): Function passes through, carrier service
  unregistered; simulator is the only preview surface.

## 3. Admin GraphQL operations

None. (Optional product picker for cart lines uses Polaris resource list client-side;
if server-side search is added it reuses a paginated `products` query in
`app/graphql/products.ts`.)

## 4. Access scopes required

None beyond 001.

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/components/simulator/SimulatorModal.tsx` — modal launcher from Rules page and Logs page.
- `app/components/simulator/CartBuilder.tsx` — line editor (reuses `ConditionRow` value input patterns from 005).
- `app/components/simulator/DestinationForm.tsx` — country/province/postal inputs reusing zone field components.
- `app/components/simulator/TraceResult.tsx` — matched-rule trace + rates table + failed-condition explanations.
- `app/routes/app._index.tsx` — "Simulate rates" action button + fetcher wiring.
- `app/routes/app.logs.tsx` — log viewer page: filters (source), pagination, expandable row detail (matched rules JSON, latency).
- `app/lib/simulate.ts` — `simulateRun(shopId, simInput): SimulationResult` declaration orchestrating the shared modules; writes the log row.
- `app/lib/prune-logs.ts` — `pruneRequestLogs(shopId)` opportunistic sweep.

## 7. Acceptance criteria

1. A simulation with a cart matching two overlapping rules shows both evaluated, marks the winner per `evaluationMode`, and names the failed condition of the loser.
2. Simulation of a destination outside all zones returns "no rates — no zone matched" with the country gate identified as the failure.
3. Simulator results are byte-identical to carrier `computeRates` output for the same fixture (parity test shared with 006 criterion 7).
4. Every simulation writes a `SIMULATION` log row visible in the log viewer with its trace.
5. Log viewer paginates 50/page newest-first, filters by source, and expands to show matched rule ids and latency.
6. After 30 days, rows disappear following any new insert (prune criterion tested with seeded old rows).
7. Test mode ON blocks the go-live card (007) and the mirror carries `testMode` (Function pass-through per 006 criterion 4).
8. Reviewer flow: a reviewer can configure a rule in test mode, simulate, and see expected rates without any live carrier registration (manual acceptance script in 010).

## 8. Open questions

1. Should `FUNCTION_DEBUG` log rows exist in MVP (Function-side diagnostics piped back)? Functions can't call home synchronously; options are CLI-log inspection or deferring to 018. Default: defer; enum reserved in 002.
2. Log retention UI setting vs fixed 30 days — default fixed; revisit with 016's versioning/audit needs.

## Standard scenarios

- **Uninstall → reinstall:** logs cascade with the shop row.
- **Plan downgrade:** simulator keeps working (no CCS dependency) — this is the demo surface for Basic merchants.
- **Partial webhook failure/retry:** no webhooks; prune is opportunistic and idempotent.
- **Large catalog:** simulator line picker paginates if server-side search is added; manual line entry always available.
