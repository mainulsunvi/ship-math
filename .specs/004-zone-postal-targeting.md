# 004 — Zone & Postal Code Targeting Engine

## 1. Problem statement

Zones decide *where* a rate or delivery-customization rule applies, via a
country → province → postal hierarchy with four postal match modes. UK and Canadian
partial-format matching is where cheap competitors break and where Zapiet charges a
premium ("Advanced postal code match"). The engine must be a pure, dependency-free
TypeScript module shared verbatim by the carrier engine (007), the simulator (008),
and the rule-condition evaluator (005), so that every surface agrees on what matches.

## 2. Data model decision

Uses `Zone` from 002 (no schema change). The matcher consumes the `Zone` JSON shape
(`countries`, `provinces`, `postalRules[]`) — decision: matching logic never touches
Prisma; callers load zones and pass them in.

- Read path: callers load enabled zones for a shop (Prisma, cached per request).
- Write path: zone CRUD in 005 UI; normalization on write (below).

**Normalization rules (decision):**
- Postal codes are uppercased; hyphens/spaces are stripped for comparison EXCEPT UK,
  which normalizes to `OUTWARD+INWARD` with a single space (e.g. `sw1a 1aa` → `SW1A 1AA`).
- Wildcard `*` = all countries / all provinces / matches any postal.
- Empty `postalRules` on a zone whose country matches = zone matches (postal unconstrained).

**Match modes (`PostalRule.mode`):**
- `EXACT` — normalized equality (`90210`, `M4B 1B3`).
- `PREFIX` — left-anchored on the normalized form (`SW1A*` covers `SW1A 1AA…`; `K7K` covers Kingston FSAs).
- `RANGE` — numeric only, inclusive (`10000-20000`); non-numeric input never matches a range rule.
- `PARTIAL` — structured partial for UK outward codes (first half + optional district digits, e.g. `EC1A`, `EC1`) and Canadian FSA (`K7K`, `K7`); validated on save against country format.

Evaluation order per destination: country must match (or `*`) → province must match (or `*`, missing province allowed only when zone lists `*`) → any postal rule matches (or none required). Zones evaluate independently; the caller decides precedence (first-match by priority in 005).

## 3. Admin GraphQL operations

None. Zones are app data.

## 4. Access scopes required

None beyond 001.

## 5. Webhook topics consumed

None new.

## 6. File-by-file change list

- `app/lib/postal.ts` — `normalizePostal(countryCode, raw)`, `validatePartialPattern(countryCode, pattern)`, `formatForDisplay(mode, rule)` declarations.
- `app/lib/zone-matching.ts` — `matchesZone(zone, destination): boolean`, `findMatchingZones(zones, destination): Zone[]` (priority order preserved), `explainZoneMatch(zone, destination): { country: boolean, province: boolean, postalRuleId?: string }` — the explain output feeds the simulator trace (008) and AI debugging (018).
- `app/lib/__tests__/zone-matching.test.ts` — the table-driven test suite (see criteria).
- `app/components/zones/PostalRuleList.tsx` + `PostalRuleEditor.tsx` — modal editors used by 005 (validation via `validatePartialPattern`).

## 7. Acceptance criteria

1. UK: `EXACT "SW1A 1AA"`, `PREFIX "SW1A"`, `PARTIAL "SW1A"` all match `sw1a1aa`, `SW1A 2AA` matches PREFIX/PARTIAL only; `SW1B 1AA` matches none.
2. Canada: `PARTIAL "K7K"` matches `K7K 5T2` but not `K7L 5T2`; `PARTIAL "K7"` matches both; `PREFIX` behaves identically to PARTIAL for FSAs.
3. US: `RANGE 10000-20000` matches `10001`, `20000`; not `20001`, not `1000`; `EXACT 90210` unaffected by input formatting `90210-1234` → matches base `90210` (ZIP+4 stripped).
4. Country gate: a zone for `CA` never matches a US destination even with identical postal strings.
5. Province gate: `["*"]` matches any/missing province; explicit list does not match missing province.
6. `findMatchingZones` returns zones in priority order and is stable for equal priorities.
7. `explainZoneMatch` identifies exactly which gate failed for a non-matching zone.
8. Full suite passes on Node 20 with zero network/Prisma imports (purity enforced by lint rule or test-import guard).
9. 100 zones × 50 postal rules evaluate a destination in < 10ms (bench criterion in test).

## 8. Open questions

1. Netherlands/France/Eircode formats: FEATURES lists Eircode under Zapiet only; do we promise Eircode partial (`A65 F4E2` → `A65`) in v1 or ship UK/CA/US/numeric only? Default per FEATURES MVP list: UK + CA partial, numeric ranges, exact/prefix — others normalize to EXACT/PREFIX.
2. Should `RANGE` support alphanumeric ranges (e.g. `SW1A-SW1B`)? Deferred; flag in editor as unsupported.

## Standard scenarios

- **Uninstall → reinstall:** zones cascade-delete (002); fresh wizard rebuilds.
- **Plan downgrade:** zone count is not tier-limited in MVP.
- **Partial webhook failure/retry:** no webhooks.
- **Large catalog:** irrelevant to zones; matcher cost is bounded by config size (criterion 9).
