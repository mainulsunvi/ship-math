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
- Prefer **modals** over custom routes for UI/UX flows and forms.

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