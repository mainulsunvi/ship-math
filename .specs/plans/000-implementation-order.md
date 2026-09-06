# ShipMath — Master Implementation Order (for GLM-4.7)

How to execute the remaining MVP specs. Design decisions live in `architecture.md`
(§A1–A6) and the numbered specs — plans below reference them; **read the spec and
architecture section before starting each plan.**

## Non-negotiable conventions (`docs/INSTRUCTION.md`)

- Full function declarations (`function name() {}`), no arrow-function components.
- Polaris React; reusable components in `app/components/`; **modals over routes**.
- Mutations via `useFetcher` + route actions; GraphQL ops as named exported
  constants in `app/graphql/`.
- Pure logic shared across surfaces lives in `app/lib/` with **zero server imports**.
- Open questions in specs are never resolved silently — ask, don't guess.

## Verified platform facts (do not re-derive)

See `.specs/PROGRESS.md` → "Verified platform facts bank": owner-metafield config,
9.5KB cap, query-cost 30, `pt`/`ct` tag variables, delivery_customizations scopes,
MOVE cheapest-first rule, `AdminApiClient` derivation pattern, Polaris 12 prop
quirks (`tone` not `color`; Tabs `content` is a string).

## Order (dependency-optimized, one implementer)

| Step | Plan | Why this position | Est. |
|---|---|---|---|
| 0 | schema v2 migration | ✅ DONE (2026-09-05) | — |
| 1 | `004-005-plan.md` zones UI + rule builder + repositories | Editors are reused by wizard (003) and AI apply (009) | 3–4 d |
| 2 | `007-plan.md` carrier engine + go-live | Wizard's carrier step needs the real probe + registration | 2–3 d |
| 3 | `008-plan.md` simulator + log viewer | Needs both engines + explain traces | 2 d |
| 4 | `003-plan.md` setup wizard | Composes editors + engines + probe; integrates everything | 2 d |
| 5 | `009-plan.md` AI assistant | Composes wizard entry + rule mutations + audit | 2–3 d |
| 6 | `010-plan.md` review kit | Needs everything shipped to derive the checklist | 1–2 d |

FEATURES §7 orders the wizard earlier; that serves parallel teams. For one
implementer, building the wizard after its dependencies exist avoids rework.

## Gate between every step (all must pass)

```
pnpm exec tsc --noEmit                     # zero errors
pnpm --filter delivery-customization test  # 8/8 fixtures (if Function touched)
pnpm run build                             # vite build clean
shopify app dev                            # manual smoke of touched surfaces
```

## Scope-change warnings

- Step 1 (004/005): none — no new scopes.
- Step 2 (007): add `read_shipping, write_shipping` to `shopify.app.toml` in ONE
  commit; the dev store will prompt reauth. Batch it — never split scope changes.
- Step 4 (003): adds `shop/update` webhook topic (no scope change).
- Step 5 (009): env vars only (`AI_PROVIDER`, `AI_MODEL_SMALL`, `AI_MODEL_LARGE`,
  provider key). No scope change.

## Environment prerequisites (flag to the human, don't invent values)

- `SHOPIFY_APP_URL` / production callback domain — needed before 007's callback
  registration is testable beyond localhost (Cloudflare tunnel acceptable in dev).
- AI provider + key — needed at step 5, not before.
