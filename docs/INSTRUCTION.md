# Project Instructions

## Scaffold
- The Shopify app is already scaffolded using the Shopify CLI. **Use the existing app.** Do not re-scaffold or create a new project structure.

## Setup Wizard
- Build a **Setup Wizard** that appears the first time a user installs the app on their store.
- The wizard should let the user configure all required settings and information for the app.
- Include an option within the wizard to **configure the app with AI**.

## Plan-Based Delivery Logic
- If the store is on a **Basic plan**, prompt the user to switch to **Delivery Customization / Delivery Function** instead of Carrier-Calculated Shipping (CCS).
- If the store has a **CCS-eligible plan** but the user hasn't enabled it, prompt the user to **enable CCS**.

## Coding Conventions
- Write all functions as **full function declarations**, e.g. `function name() {}`.
- **Avoid arrow functions** unless the situation specifically calls for one (e.g. preserving `this` context, inline callbacks where a declaration would be awkward).

## Spec Driven Development
- Read `docs/FEATURES.md` and generate specs based on the features listed there.
- **Prioritize MVP specs first**, then move on to secondary/additional features.
- Make sure the MVP includes some AI features.

## UI/UX (Polaris)
- Use **Polaris React** components throughout the app.
- Build reusable UI components inside `app/components/` and reuse them wherever applicable instead of duplicating markup/logic.
- Prefer **modals** over custom routes for UI/UX flows and forms — EXCEPT rules: rule create/edit live on dedicated routes (`/app/rules/new`, `/app/rules/:uid/edit`) with the shared `RuleForm` component, addressed by the rule's public `uid` (user decision 2026-09-07).
- **Boolean toggles always use the Switch component** (`app/components/ui/Switch.tsx`) — never Checkbox, Polaris SettingToggle, or button-based toggles (user directive 2026-09-06).

## UX Writing (user directive 2026-09-09)

Every merchant-facing UI string follows these binding rules:

1. **Headings use Title Case.** Page titles, card and section headings, modal titles, and table column headers capitalize every major word ("Checkout Function Status", "Stop on Match", "Rate Simulator"). Buttons, field labels, option lists, and body text stay in sentence case ("Save changes", "Rule name").
2. **Never use em-dashes (—) or en-dashes (–) in UI strings.** This covers headings, banners, badges, tooltips, help text, error messages, flash/audit messages, option labels, and placeholders. Use a period, colon, semicolon, or parentheses instead. The only allowed dash glyph is the lone "—" used as an empty-value placeholder in tables and lists.
3. **Help text uses the Polaris Tooltip pattern.** Field-level help stays short (one sentence) in the component's `helpText`; anything longer rides the shared info icon + Tooltip component `app/components/ui/HelpTooltip.tsx` next to the heading or row it explains. Never dump multi-sentence explanations into `helpText`.
4. **No developer jargon in UI strings.** Never show raw enum values (`CARRIER_RATE`, `FIRST_MATCH`, `true`/`false`); use the friendly label maps (`KIND_LABELS`, `EVALUATION_MODE_OPTIONS`, "Yes"/"No"). Write errors and statuses as full sentences a merchant can act on.
5. **Pluralize counts properly**: "1 rule", "2 rules", "kept for 30 days". Never "rule(s)", "zone(s)", "run(s)".
6. **Every sentence starts with a capital letter**, including fragments after a "·" separator, and ends with a period.

## Forms
- Use the **`useFetcher`** hook for form handling.
- Use **Form Actions** (Remix/React Router actions) for form submissions.

## GraphQL
- Create a dedicated directory: `app/graphql/`.
- Store all **queries** and **mutations** there as `.js`/`.ts` files.
- **Reuse existing queries/mutations** instead of redefining them. Wrap common patterns in functions to increase reusability.

Example query/mutation file format:

```ts
export const CREATE_COLLECTION = `#graphql
mutation collectionCreate($input: CollectionInput!) {
  collectionCreate(input: $input) {
    collection {
      id
      title
      handle
      templateSuffix
      ruleSet {
        appliedDisjunctively
        rules {
          column
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;
```

## Documentation
- User-facing help documentation lives in **`docs/help/`** and must follow eight binding rules (user directive 2026-09-07):
  1. Point of view is **you/your** — write directly to the store owner.
  2. Use VISIBLE placeholders in square brackets where screenshots go, like `[Add Zone Condition Screenshot]`. Never hide them in HTML comments (they are invisible when rendered).
  3. Every document has a **Video tutorial** section with a visible placeholder, like `[Add Getting Started Video Tutorial]`.
  4. Prefer how-to / doc-blog style: short intro, headed steps, what-to-read-next.
  5. **Docs ship with code** — finishing a task or changing app behavior includes updating the affected `docs/help/` pages in the same run.
  6. Always check grammar and use easy-to-read English words. Describe outcomes in the **future tense**: after the reader acts, say what will happen next ("Click **Save**. A green banner will confirm the change."). Write naturally, the way one person explains things to another; avoid formulaic patterns that read as AI-generated (endless bold-lead bullet lists, filler like "The good news:", perfectly parallel sentences).
  7. Never use the word "we" (or "us"/"our") in help content — the docs are for the merchant, not the developer.
  8. Never use em-dashes in help content.

## Sub-Agents
Create the following agent definition files, each configured with the selected model for its role:

- `architect.agent.md`
- `backend.agent.md`
- `documentation.agent.md`
- `frontend.agent.md`
- `orchestrator.agent.md`
- `planner.agent.md`
- `reviewer.agent.md`
- `security.agent.md`
- `tester.agent.md`

Example of a sub-agent file
```md
---
name: Architect
description: 'Decides system shape for FAQzic: data model, API surface, Prisma schema, folder structure. Produces a numbered spec in .specs/ and updates architecture.md. Makes design decisions. Does not break work into tasks and does not write implementation code.'
model: ['GLM-5.2']
tools: ['read', 'search', 'edit']
argument-hint: The feature to design
---

# Architect

You decide the shape of things. You do not build them and you do not schedule
them.

## Before proposing anything

Read `architecture.md` and the three most recent files in `.specs/` so that
numbering, naming, and conventions stay consistent. Read the Prisma schema.

## Responsibilities

- Define project architecture and select design patterns
- Define folder structure and the API surface
- Define the Prisma schema and any migration path from the current one
- Produce sequence diagrams as mermaid blocks inside the spec
- Update `architecture.md` when a decision changes it

## Output contract

Write exactly one numbered spec to `.specs/NNN-slug.md`. It must contain, in
this order:

1. **Problem statement.** Two or three sentences.
2. **Data model decision.** Shopify metafield vs metaobject vs Prisma table,
   with the reasoning. State the read path and the write path separately.
3. **Admin GraphQL operations**, named explicitly. Note the estimated cost
   for anything in a loop.
4. **Access scopes required**, and whether `shopify.app.toml` changes. Flag
   it loudly if it does, because that forces merchant reauthorization.
5. **Webhook topics consumed**, with the idempotency key for each.
6. **File-by-file change list.** Path, and one line on what changes.
7. **Acceptance criteria.** Each one must be verifiable by a test. No
   criteria like "works correctly".
8. **Open questions.** List them. Never silently resolve one by guessing.

## Always answer these four

Every spec states what happens on:

- App uninstall, then reinstall by the same shop
- Plan downgrade while data exceeds the lower plan's limits
- Partial webhook delivery failure and the retry that follows
- A shop with an unusually large catalog, where pagination changes behaviour

## Never

- Write business logic or UI
- Edit anything outside `.specs/` and `architecture.md`
- Produce a task breakdown, ordering, or estimates. That is Planner's job.
- Resolve an open question by picking one arbitrarily
```