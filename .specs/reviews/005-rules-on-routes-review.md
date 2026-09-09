# Review — Rules on routes + public uid (2026-09-07 change, reviewed late)

Verdict: **CHANGES REQUESTED** (1 REQUIRED, 3 SHOULD, 4 NOTE; nothing BLOCKED)
Reviewed: 2026-09-09 · Reviewer mode · Change summary: `.specs/PROGRESS.md` §"Rules on
routes + public uid" · Convention: `docs/INSTRUCTION.md` §UI/UX ("rules live on dedicated
routes … addressed by the rule's public `uid`", user decision 2026-09-07)

Committed-vs-working-tree check: no terminal tool was available in this session, so
`git log` / `git show` could not be run by the reviewer. Per the operator's statement and
`.specs/PROGRESS.md` ("scopes commit `6ae3fe5` landed BEFORE the no-commit directive;
nothing committed since"), this change is **uncommitted working-tree state** and was
reviewed as such. Files read in full: `prisma/migrations/20260906184713_rule_uid/migration.sql`,
`prisma/schema.prisma`, `app/lib/repositories/rules.ts`, `app/routes/app.rules.new.tsx`,
`app/routes/app.rules.$uid.edit.tsx`, `app/components/rules/RuleForm.tsx`,
`app/components/rules/RulesTable.tsx`, dashboard rewiring in `app/routes/app._index.tsx`,
nav surfaces (`app/routes/app.tsx`, `app/components/global/ShipMathNav.tsx`),
`app/lib/repositories/__tests__/rules.test.ts`, plus grep sweeps for dangling
`RuleEditorModal` references. Gates not re-run (operator re-ran them for the current tree:
tsc 0 · 328 root tests · build clean, which subsumes this change); IDE diagnostics clean on
the new route files and `RuleForm.tsx`.

## 1. Verdict: CHANGES REQUESTED

- **REQUIRED — both navigation surfaces link to `/app/rules`, which is not a route.**
  `app/routes/app.tsx:69` (`<Link to="/app/rules">Rules</Link>` in the App Bridge NavMenu)
  and `app/components/global/ShipMathNav.tsx:49` (Rules tab `url: "/app/rules"`) target a
  path no route matches: `app.routes.new.tsx` serves `/app/rules/new` and
  `app.rules.$uid.edit.tsx` serves `/app/rules/:uid/edit`, and `routes.ts` is plain
  `flatRoutes()` with no `app.rules` index/stub file on disk (verified by file search).
  Clicking Rules in either nav renders a 404 boundary inside the embedded app. This is a
  dashboard-rewiring completeness gap: the rules concept was promoted to a nav destination
  without a destination route. Cheapest fix consistent with house style: add
  `app/routes/app.rules._index.tsx` as a loader-redirect to `/app` (same bookmark-safe
  pattern as `app.additional.tsx`), or point both nav entries at `/app` (the dashboard
  already is the rules page, titled "Shipping Rules"). Note the ShipMathNav prefix matcher
  already handles `/app/rules/new` and `/app/rules/:uid/edit` correctly once the tab URL
  exists.

Should-fix and notes follow; re-review expected APPROVED after the REQUIRED item and the
dead-handler cleanup.

## 2. Findings table

| Severity | Location | Description | Suggested fix |
|---|---|---|---|
| REQUIRED | `app/routes/app.tsx:69`; `app/components/global/ShipMathNav.tsx:49` | Nav "Rules" links 404 (§1) | `app.rules._index.tsx` redirect to `/app`, or retarget the links |
| SHOULD | `app/routes/app._index.tsx:348` (`handleRuleCreate`), `:364` (`handleRuleUpdate`), action branches in `action()` | Dead handlers: since the UI moved to the dedicated routes, nothing posts `rule-create` / `rule-update` to `/app` (grep: the only submitters are the new route files' own fetchers). The intents remain reachable only by hand-crafted POSTs and mislead future readers about the dashboard's contract. | Delete both handlers + their branches (keep `parseRuleForm` — the wizard intents use it), or keep one deliberately with a comment saying it is the wizard/legacy parse host. |
| SHOULD | `app/routes/app._index.tsx:195-270`; `app/routes/app.rules.new.tsx:44-115`; `app/routes/app.rules.$uid.edit.tsx:36-107` | `parseRuleForm` + `zodIssuesText` now exist in THREE byte-identical copies (dashboard, new route, edit route). Spec 003's `zone-form.ts` extraction is the established precedent for exactly this drift risk: three copies of the rule-form validation contract will diverge on the next field addition. | Extract to `app/lib/rule-form.ts` (pure: zod + config-schema imports, purity-guard allowlist entry) and import from all three routes + the wizard intents. |
| SHOULD | `app/components/global/ShipMathNav.tsx:126` | `const handleTabChange = (selectedTabIndex: number): void => {…}` — arrow at component scope, violating `docs/INSTRUCTION.md` §Coding Conventions. This exact arrow was REQUIRED-fixed in the 2026-09-06 design review and was reintroduced when the tab list grew; the whole file also carries a uniform 2-space indent offset and an inconsistent `id: "Rules"` (siblings are lowercase). | Restore `function handleTabChange(…)`, dedent the file, `id: "rules"`. |
| NOTE | `app/lib/repositories/rules.ts:57-80` | The P2002 collision-retry loop (`insertWithUniqueUid`) has no test — PROGRESS's claim "P2002 retry ×3" describes the implementation, not coverage (the 5 new tests are mint/round-trip/cross-shop/duplicate-uid/smuggled-uid). Forcing a collision needs a `randomBytes` mock; acceptable to leave, but the claim should not be read as tested. | Optional: vi.mock `node:crypto` to return a constant buffer twice, assert the third attempt succeeds. |
| NOTE | `prisma/migrations/20260906184713_rule_uid/migration.sql:6-10` | Comment says "Deterministic per row via hex(id) substring seeding" but the statement uses `randomblob(5)` hex (10 lowercase hex chars). Harmless (cuid uniqueness made the old claim irrelevant) but the comment describes a different mechanism than the one shipped. Backfill collision would fail the migration loudly — acceptable, the unique index is the point. | Fix the comment wording. |
| NOTE | `prisma/schema.prisma` (`uid String? @unique`) | Column stays nullable although every create path mints and the migration backfilled; `toRuleRow` defends with `?? undefined` and the edit route 404s on a null-uid row reached via `/app/rules/undefined/edit`. Fine for now; a later not-null migration would close the type hole for good. | Optional follow-up migration `ALTER COLUMN uid SET NOT NULL`. |
| NOTE | `app/components/rules/RuleForm.tsx:281` | helpText "Enter a Rule name for reference." capitalizes "Rule" mid-sentence (sentence case would be "Enter a rule name for reference."). | One-word fix. |

## 3. Claim-by-claim verification (PROGRESS §"Rules on routes + public uid")

- **uid minting** — `generateRuleUid()` (`rules.ts:44-52`): 10 chars from
  `randomBytes(10)` mod 36, server-side only. Tested: mint shape + distinctness
  (`rules.test.ts:248-255`). ✓
- **P2002 retry ×3** — implemented (`insertWithUniqueUid`, `rules.ts:57-80`), retries only
  on `PrismaClientKnownRequestError` code P2002 (uid is the only unique constraint a create
  can hit — id is a cuid), rethrows the last collision after 3 retries. Shared by
  `createRule` and `duplicateRule`. Untested (NOTE above). ◐
- **`getRuleByUid` cross-shop null** — `rules.ts:97-104`: `findUnique({ where: { uid } })`
  then `rule.shopId !== shopId → null`, so a foreign uid is indistinguishable from an
  unknown one. Tested cross-shop AND unknown (`rules.test.ts:266-272`). ✓
- **`updateRule` ignores smuggled uid** — two layers: `StoredRuleSchema.parse` strips
  unknown keys (zod default), and the update payload (`rules.ts:130-140`) simply does not
  include `uid`. Tested with a smuggled `uid: "smuggled01"` (`rules.test.ts:282-291`: name
  applied, uid untouched). ✓
- **5 new tests** — `describe("rule uid")` contains exactly 5. ✓
- **Migration `20260906184713_rule_uid`** — additive: ADD COLUMN + backfill + UNIQUE
  index; matches `schema.prisma` exactly (`uid String? @unique`); reversible in principle
  (drop index, drop column) though no down file is house style here. ✓
- **Gates green at the time** — consistent with the current operator re-run (tsc 0, 328
  tests) which includes these files. ✓

## 4. Convention compliance (requested checks)

- **Rules route-based:** `/app/rules/new` and `/app/rules/:uid/edit` exist as routes; the
  dashboard's New rule / Edit actions navigate instead of opening modals
  (`app._index.tsx` `openNewRule` / `openEditRule`); rule deletion stays a confirm modal
  (allowed — the convention scopes create/edit to routes); the exception is codified in
  `docs/INSTRUCTION.md`. ✓
- **Modal deletion left no dangling imports:** `RuleEditorModal.tsx` is gone from
  `app/components/rules/`; grep for `RuleEditorModal` across `app/**` returns only a
  historical comment in `RuleForm.tsx:42`. Dashboard modal state (`editorRule` etc.)
  removed; `deleteTarget` modal remains for deletes. ✓
- **`RuleForm` is reuse, not a fork:** it embeds the shared `ActionEditor`,
  `ConditionGroupEditor`, `KindChip`, `SettingToggle`, `HelpTooltip`; create + edit differ
  only by `mode`/`initial`; both routes and the wizard's Rates step consume the same
  component (wizard passes `submitLabel="Save draft"`). ✓
- **Loader 404 paths:** edit loader throws `new Response("Rule not found", { status: 404 })`
  on unknown OR foreign uid; the edit action returns a 404 JSON reply for a rule deleted
  between load and submit. ✓
- **Dashboard rewiring completeness:** `toRuleRow` carries `uid ?? undefined`;
  `openEditRule` builds `/app/rules/${rule.uid}/edit`. Residual gaps are the REQUIRED nav
  404 and the SHOULD dead handlers. ◐
- Function declarations throughout the new files; `useFetcher` for submissions; headings
  Title Case ("New Rule", "Edit Rule"), buttons sentence case ("Create rule", "Save
  changes", "Cancel"); `ID: <uid>` display matches the FAQ's "short ID" documentation
  (docs shipped with code ✓); no em/en-dashes in any new UI string; Polaris-only markup.

## 5. uid security review

- uids are generated server-side from `crypto.randomBytes` only; no code path parses a uid
  out of client-controlled form data — `params.uid` is used solely as a lookup key
  (loader + action), and writes address the row by the server-resolved `id`.
- Cross-shop isolation is enforced twice: `getRuleByUid` nulls foreign uids, and
  `updateRule` re-scopes by `{ id, shopId }` even if the id leaked.
- Enum-style guessing surface: 36^10 with a per-shop scoping check; no information leak
  beyond exist/non-exist for the shop's own rules (foreign and unknown are identical).
- Backfilled legacy rows got real uids, so bookmarked `/app/rules/<uid>/edit` links work
  for pre-migration rules; a theoretically-null uid row degrades to a 404, not a cross-shop
  read.

## 6. Standard scenarios (the four, always)

- **App uninstall → reinstall:** rules cascade with the Shop row on the (documented,
  spec-002) path where data is wiped; on the actual current webhook path the rows survive
  with their uids intact and re-serve the same edit URLs. uids have no cross-install
  semantics; reinstall cannot collide (fresh mints, unique index). No hazard.
- **Plan downgrade while data exceeds limits:** nothing tier-gated here; the 50/page
  pagination and unique index behave identically on any plan.
- **Partial webhook delivery + retry:** no webhooks in this change; the analogous
  double-submit (duplicate-click on Save) is a single idempotent `updateRule` by id — last
  write wins, no duplication; duplicate-click on Create mints two rules, same as before
  (pre-existing semantics, unchanged by this change).
- **Unusually large catalog:** catalog-agnostic; the rules table paginates at 50 with
  loader-side page clamping (retained); the edit route loads ONE row via the unique uid
  index; `app.rules.new`'s loader counts rules in one indexed query for the suggested
  priority. No pagination-shaped hazards.

## 7. Positive notes

- The routes are honest verbatim ports: both actions preserve the load-bearing §A1 order
  (repository → ensureFunctionOwner → pushFunctionConfig → writeAudit) and the
  fail-open sync-report semantics; audits now carry uids, which helps support quote a rule.
- `getRuleByUid`'s "foreign == unknown" null contract is the right security posture and is
  explicitly tested both ways.
- `insertWithUniqueUid` correctly narrows P2002 to the only unique constraint a create can
  hit, and sharing it with `duplicateRule` guarantees a copy can never inherit a uid.
- Deleting `RuleEditorModal` was clean (no zombie imports, no dead props threading through
  the dashboard), and `ShipMathPage`'s `backAction` passthrough kept the routes on the
  shared page shell instead of a bespoke layout.

## §manual — human smoke script

1. Dashboard → **New rule** → lands on `/app/rules/new` with suggested priority; Create →
   returns to the dashboard with the rule enabled and the sync banner clean.
2. Edit the rule → URL is `/app/rules/<uid>/edit`, subtitle shows the rule name and
   `ID: <uid>`; Save changes → back to the dashboard, mirror synced.
3. Bookmark the edit URL, then delete the rule from the table → open the bookmark → 404
   page (not another shop's rule, not a crash).
4. From a second dev shop, open shop A's edit URL → 404 (cross-shop isolation).
5. Duplicate a rule from the table → copy appears adjacent, disabled, and its edit URL has
   a DIFFERENT uid than the source.
6. In a second browser tab, delete a rule while its edit page is open, then press Save
   changes → 404 reply rendered as an error, no phantom write.
7. **Nav check (the REQUIRED item):** click Rules in the left App Bridge nav and in the
   top tab bar → both must land somewhere real (dashboard or a rules index), never a 404.
8. Back button behavior: browser Back from the edit page returns to the dashboard with
   state intact.

— Reviewer, 2026-09-09

---

## Re-verification — 2026-09-09 (orchestrator fixes applied)

- **REQUIRED fixed**: NEW `app/routes/app.rules._index.tsx` redirects `/app/rules` →
  `/app` (the `app.additional.tsx` pattern). Both navs (App Bridge NavMenu and the top tab
  bar) now land on the dashboard rules table instead of a 404.
- **SHOULD fixed**: dead `rule-create`/`rule-update` intents + handlers removed from
  `app._index.tsx` (verified no submitters anywhere; the rule routes own those intents
  now); `parseRuleForm` + `zodIssuesText` extracted to shared `app/lib/rule-form.ts`,
  imported by `app._index.tsx` (wizard draft), `app.rules.new.tsx`, and
  `app.rules.$uid.edit.tsx` — three copies → one.
- **SHOULD skipped by directive**: ShipMathNav `handleTabChange` arrow + file-wide indent
  remain untouched — `ShipMathNav.tsx` is user-owned per the standing directive in
  `docs/INSTRUCTION.md` and project memory; the vertical tab layout and existing style are
  explicitly accepted by the user.
- NOTEs: migration comment (`hex(id)` vs `randomblob`) and nullable-uid column left as-is
  (additive, backfilled, harmless); "Rule name" capitalization matches the current
  RuleForm label.

Verdict after fixes: **APPROVED** (ShipMathNav items permanently out of scope by user
directive).

— Orchestrator, 2026-09-09
