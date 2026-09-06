# 013 — Live Carrier Rates

> Status: **future / post-MVP**. Depends on: 007 (engine), 011 (packages for rating).

## 1. Problem statement

FEATURES §4.3: negotiated-rate passthrough from FedEx, UPS, USPS, DHL, Canada Post,
Australia Post, Royal Mail using merchant credentials; service-code filtering;
markups/markdowns per service; custom titles; aggregators (Starshipit, Sendle,
ShipStation, EasyPost); dropship passthrough (Printful, Printify, Gooten); and a
fallback rate on carrier API failure or timeout.

## 2. Data model decision

- `CarrierCredential` table: provider, encrypted credentials (AES-256-GCM, key from
  env KMS), per shop.
- `CarrierServiceMapping` table: provider service code → title, markup%, enabled.
- Engine change: rate pipeline becomes fan-out to providers with per-provider timeout
  (500ms budget each, aggregate cap inside 007's 1500ms) + fallback on failure.

## 3. Admin GraphQL operations

None. Credentials are external-provider data, stored app-side only.

## 4. Access scopes required

None new.

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/lib/crypto/credentials.ts` — encrypt/decrypt helpers.
- `app/lib/providers/*.ts` — one adapter per carrier (normalized rate shape).
- `app/lib/providers/registry.ts` — adapter registry + capability flags.
- `app/routes/app.carriers.tsx` + `app/components/carriers/*` — credential + service mapping UI.
- Carrier engine fan-out integration + provider circuit-breaker counters (in-memory, feeds 019).

## 7. Acceptance criteria

1. Each adapter normalizes a recorded provider response fixture into the common rate shape (contract tests).
2. Markup/markdown applied per service code, order-stable.
3. Provider timeout yields fallback rate, never an error to Shopify (fuzzed-latency test).
4. Credentials never appear in logs (test asserts redaction) and are encrypted at rest.
5. Service filtering drops disabled codes before response shaping.
6. Aggregator adapter (EasyPost first) passes the same contract tests.

## 8. Open questions

1. Credential key custody (env KMS vs platform secret store) — blocks implementation.
2. Which providers ship first? FEATURES implies FedEx/UPS/USPS/DHL priority; confirm with support load capacity.

## Standard scenarios

- **Uninstall/reinstall:** credentials cascade-delete (mandatory — GDPR posture).
- **Plan downgrade:** live carriers are Pro features; downgrade disables fan-out, fallback engages.
- **Partial webhook failure/retry:** none; provider retries governed by circuit breakers (019).
- **Large catalog:** rating is shipment-shaped; multi-box carts from 011 multiply provider calls — cap boxes per request (configurable, default 5).
