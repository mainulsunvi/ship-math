# Shopify Shipping Rates App — Feature & Pricing Spec

**Prepared for:** Pixelfic Inc.
**Date:** September 2026
**Status:** Pre-build planning

---


## Special Instruction 
- I already scafold a shopify app using cli, so you have to use that app. 
- I need a Setup wizerd when ever some one install the app, and if an user install the app to the store for the first time, the user will find a setup wizard where all settings and iformation can be setup, also there will be an option to configure the app with AI. 
- If the store is in basic plan then ask user for switch to Delivery Function insted of CCS / if the store has CCS Plan and user didn't enabled it, then ask to enable it.
- I need all the function in the app to be a full function Like `function name() {}`, avoid use arrow function untill you need it. 
- Read the ``docs/FEATURES.md`` file and generate specs using the features. Also make sure MVP Specs are priority first then other feaures. 
- Use polaris react components. In UI / UX make sure you create compoments in ``app/components/`` and re-use it whenever you need. 
- User `useFetcher` hook for form handling, and Form Actions. 
- For GAPHQL create a directory /app/graphql, create queries and mutations files there as js/ts file and use when ever you need queries or mutations. Just make sure you reuse queries instead of creating it again and again. Also you can create functions for increase reusability.
- For UI/UX and forms, use modal more then custom routes.
- 

## 1. Competitive Baseline

Five reference apps analysed from their Shopify App Store listings.

| App | Developer | Pricing | Rating | Core angle |
|---|---|---|---|---|
| ShipX — Shipping Rates & Rules | Logbase | Free plan + $9.99 / $24.99 / $34.99 | 5.0 (1,173) | Broad conditional rate engine |
| SMART Shipping Rates & Rules | E-TRADE PARTNER | Free to install + $9.99 / $19.99 | 5.0 (389) | Built for Shopify, Functions-first |
| Zapiet — Rates by Distance | Zapiet | Free to install + $14.99, metered overage | 4.9 (125) | Local delivery radius |
| Zapiet — Rates by Zip Code | Zapiet | $14.99/mo | 4.8 (137) | Postal code targeting |
| Advanced Shipping Rules | Bambri | $9 / $29 / $59 / $99 | 4.9 (295) | Rule logic + real-time carriers |

### Distinctive features by app

**ShipX (Logbase)**
- Rate blending to combine multiple rates
- AI-based packing algorithm for dynamic rates by box size and weight
- Rates by supplier, dimension, volumetric weight, carrier
- Rate history for debugging
- Incremental and tiered rates, percentage-based, max shipping fee cap
- Handling fees and shipping discounts
- Restrict shipping to specific addresses
- Pickup points for FedEx, DHL, UPS, USPS
- Delivery customization (rename/hide/reorder) without CCS API

**SMART Shipping Rates (E-TRADE PARTNER)**
- Hide, sort and rename delivery methods on 20+ conditions
- CSV import/export
- Activity logs and rate simulator
- Multi-origin support
- PO Box restrictions, address validation
- Tiered, per-unit increment and percentage calculations
- B2B, customer tag and login-state rules
- Show cheapest or highest rate only
- Date, discount and language based rules
- Lite tier explicitly works on Basic plan with no CCS required

**Zapiet — Rates by Distance**
- Straight-line radius and driving-distance calculation
- Shortest vs. fastest route selection
- Maximum delivery distance cap
- Unique rules per store location, 1–100 locations
- Weight and price based rules per location
- Translatable rates
- Metered pricing: $0.10 / $0.05 per rate calculation over plan limit

**Zapiet — Rates by Zip Code**
- Zip code, postal code, Eircode and pincode support
- Advanced partial postal code matching (aimed at UK and Canada)
- Tiered pricing per zip code, order weight and price
- Multi-language rate display
- AI setup wizard

**Advanced Shipping Rules (Bambri)**
- Conditional logic to hide, show, add to, or subtract from a rate
- Product groups (2 / 5 / 20 / unlimited by tier)
- Blended rates and blending rules
- Service codes and package settings
- Custom rate titles
- % of product price, per pound, per item
- Postal code subzones
- Toggle rates based on customer tags
- Dropshipper rate integrations (Printful, Printify, Gooten)
- Unlimited free trial in test mode

---

## 2. Architecture Decision

Shopify splits this problem into two mechanisms. This split determines the MVP scope.

### Delivery Customization Functions
- Modifies rates that already exist: hide, rename, reorder
- Works on **every Shopify plan**
- No Carrier Calculated Shipping requirement
- Runs at checkout, deployed as a Shopify Function

### Carrier Service API
- **Generates** new rates by calling your endpoint
- Requires Carrier Calculated Shipping (Advanced plan, annual Basic/Grow, or paid add-on)
- Your endpoint must respond fast and must never break checkout

**Strategy:** lead with Functions. It works for every merchant on Basic, is faster to build, and is easier to pass review. SMART's Lite tier is deliberately Functions-only and marketed as "works on Basic plan, no CCS needed." Layer the Carrier Service engine on top.

---

## 3. MVP — v1.0 Submission Scope

Goal: one complete, reviewer-testable loop on a development store, without CCS.

### 3.1 Rate engine (Carrier Service, minimal)
- [ ] Flat rate rules
- [ ] Free shipping rules
- [ ] Conditions: cart subtotal, total weight, item quantity
- [ ] Tiered / range tables (0–5 kg → $X, 5–10 kg → $Y)
- [ ] Per-unit incremental pricing
- [ ] Percentage-of-cart pricing
- [ ] Handling fee add-on per rate
- [ ] Presentment currency handling

### 3.2 Zone targeting
- [ ] Country → province/state → postal code hierarchy
- [ ] Postal code lists: exact match
- [ ] Postal code wildcard / prefix match
- [ ] Numeric postal code ranges
- [ ] Partial-match logic for UK and Canadian formats
- [ ] Enable / disable per zone

> UK and Canada partial matching is where cheap apps break. Zapiet sells "Advanced postal code match" as a headline feature. Get it right in v1.

### 3.3 Delivery customization (Functions — no CCS)
- [ ] Hide rate by condition
- [ ] Rename rate title
- [ ] Reorder / sort rates
- [ ] Conditions: product tag, collection, SKU, vendor, customer tag, logged-in state, cart total, weight, destination

### 3.4 Rule builder UX
- [ ] IF / THEN condition builder
- [ ] AND / OR grouping
- [ ] Rule priority ordering
- [ ] First-match vs. all-match behaviour setting
- [ ] Duplicate rule
- [ ] Enable / disable toggle per rule

### 3.5 Testing and trust — do not cut
- [ ] **Test mode** — configure and preview without going live
- [ ] **Rate simulator** — enter a cart plus address, see which rules fired and what was returned
- [ ] **Rate request log** — recent calls with matched rule and returned rates

Every competitor ships test mode, and your Shopify reviewer will use it. The simulator and log are your primary support-ticket deflectors.

### 3.6 Platform requirements — review blockers if missing
- [ ] Embedded app: App Bridge + Polaris
- [ ] Session token authentication
- [ ] OAuth with online and offline tokens
- [ ] Shopify App Pricing configured (no custom Billing API code needed)
- [ ] Mandatory GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact`
- [ ] `app/uninstalled` cleanup
- [ ] HMAC verification on all webhooks
- [ ] Carrier service callback responds well inside Shopify's timeout
- [ ] Graceful fallback rate — never return an error that blocks checkout
- [ ] Onboarding checklist
- [ ] In-app documentation links
- [ ] Privacy policy and terms of service pages
- [ ] Listing assets: icon, 3+ screenshots, demo video, demo store URL, reviewer test instructions

---

## 4. Advanced Product — Full Roadmap

### 4.1 Advanced rate calculation
- Dimensional / volumetric weight
- Cubic volume rates
- Per-item dimensions via metafields
- **Product groups** — the most-requested advanced primitive across all five apps
- Per-item and per-pound rates
- Percentage of product price
- Rate blending: sum, max, min, cheapest-only, highest-only, weighted
- Multi-origin and per-location rules
- Vendor / supplier-based rates for dropship and marketplace catalogs
- Box-packing algorithm: pack cart into defined package sizes, rate per box
- Maximum shipping fee caps
- Shipping discounts

### 4.2 Distance and geo
- Straight-line radius rates from each location
- Driving-distance rates
- Route mode: shortest vs. fastest
- Maximum deliverable distance with a clear "we don't deliver here" state
- Per-location distance tiers
- Geocoding cache keyed on normalized address (cost control)

### 4.3 Live carrier rates
- FedEx, UPS, USPS, DHL, Canada Post, Australia Post, Royal Mail using merchant credentials
- Service code filtering
- Markups and markdowns per service
- Custom service titles
- Aggregator integrations: Starshipit, Sendle, ShipStation, EasyPost
- Dropship rate pass-through: Printful, Printify, Gooten
- Fallback rate on carrier API failure or timeout

### 4.4 Restrictions and compliance
- Block products from specific regions (hazmat, alcohol, oversized)
- PO Box / APO / military address blocking
- Address validation
- Residential vs. commercial detection
- Order minimums and maximums per rate
- Blackout dates
- Cutoff times
- Lead / prep times
- Delivery date estimates in the rate title

### 4.5 B2B and customer segmentation
- Rates by customer tag
- Rates by company and company location (B2B)
- B2B catalog awareness
- Wholesale-only rates
- Account-specific negotiated pricing
- Logged-in vs. guest differentiation

### 4.6 Merchant operations
- CSV import / export of zones, postal codes and rate tables
- Rule versioning with change history and rollback
- Clone full configuration across stores
- Bulk edit
- Analytics: rate impressions, selection rate per rate, abandonment at shipping step
- Shipping cost vs. actual label cost variance reporting
- Multi-language and multi-currency rate titles
- Alerting when a cart returns zero rates

### 4.7 Scale and reliability
- Edge-cached rate responses
- Idempotent rate keys
- Per-shop rate limiting
- Circuit breakers on carrier APIs
- Public status / uptime page

---

## 5. AI Setup Assistant

Zapiet ships this on Rates by Zip Code, listed as "Zapiet AI Setup Wizard." Their implementation is an express setup modal offering three shortcuts — Create a zone, Create rates, Full setup — plus a free-text input, with the standard "AI can make mistakes, check important info" disclaimer.

This is a validated direction and worth building, because setup friction is the single biggest cause of churn in this category. Every five-star review in the reference set is about a human support agent doing the configuration for the merchant. Automating that is the highest-leverage feature you can build.

### 5.1 Proposed scope

**Natural language → structured configuration**
- Merchant types: "Free shipping over $75 in Ontario, $12 flat everywhere else in Canada, don't ship to the territories"
- LLM outputs a structured rule set as JSON matching your internal schema
- Never write directly to the database from model output

**Preview and diff before apply**
- Show exactly which zones and rules will be created, updated or deleted
- Highlight destructive changes in a distinct style
- Require explicit confirmation
- Support partial acceptance ("apply zones, skip rates")

**Bulk postal code parsing**
- Merchant pastes a messy list from a spreadsheet or a carrier PDF
- Model normalizes into valid postal codes, prefixes and ranges
- Flags unparseable entries for manual review rather than silently dropping them

**Entry points**
- Onboarding wizard on first install
- Persistent "Set up with AI" button in the rules index
- Guided shortcuts (Create a zone / Create rates / Full setup) plus free-text input

### 5.2 The differentiated direction — reverse mode

Zapiet uses AI for setup. Nobody is using it for **debugging**, which is where the support tickets actually are.

- "Why did this customer see $45 shipping?" → the model reads the rate request log, identifies the matched rule and explains the calculation in plain language
- "Why is no rate showing for this cart?" → traces which condition failed
- Suggests the specific fix and offers to apply it

This pairs directly with the rate simulator and request log from the MVP scope. Those three together form a defensible product story against apps with a five to ten year head start on raw feature count.

### 5.3 Guardrails
- Model output must validate against the rule schema before preview is rendered
- Never auto-apply; confirmation is mandatory
- Every AI-generated change written to the audit log, tagged as AI-originated, with one-click rollback
- Rate-limit AI requests per shop per day
- Visible disclaimer, matching platform convention
- Do not send customer PII to the model; send schema and configuration only

### 5.4 Cost implication

LLM calls are a real per-shop cost on a flat-price plan. Mitigations:
- Cap AI requests per shop per billing period (generous cap, quietly enforced)
- Use a small, fast model for parsing and normalization tasks; reserve the larger model for full setup and debugging
- Cache and template common patterns rather than round-tripping every request

---

## 6. Pricing Model

### 6.1 Structure

| Plan | Price | Scope |
|---|---|---|
| Development stores | Free forever | All features |
| Test mode (live stores) | Free, unlimited | Full configuration, no live rates |
| Pro | $29 / month | All features, 14-day free trial |
| Pro Annual | $290 / year | All features, marketed as "2 months free" |

### 6.2 Implementation

Use **Shopify App Pricing** (formerly Managed Pricing). It is the default and recommended approach for new public apps. Plans are defined in the app submission form, Shopify hosts the plan selection page, and it automates recurring charges, free trials, proration, no-charge testing and price updates. No Billing API code required.

### 6.3 Rationale and constraints

**Development stores are free automatically.** Shopify's no-charge testing handles this. Note that "staging site" is not a Shopify concept — a merchant's staging store is either a development store (already free) or a second paid store that will bill normally. There is no reliable way to detect the difference. Either comp these manually through support or don't advertise staging at all.

**The free trial is not optional.** With a single paid plan and no free tier, merchants hit a paywall at install while you have zero reviews. ShipX carries a "Free plan available" badge, SMART carries "Free to install," Bambri offers an unlimited free trial in test mode. Those badges drive installs, installs drive reviews, reviews drive ranking. The unlimited test-mode tier costs almost nothing to serve because no live rate calls go out.

**Price at $29, not $9.** Direct comparison set: SMART Pro $19.99, ShipX Premium $34.99, Bambri Pro $59 and Unlimited $99. A single all-features plan at $29 reads as a bargain against a $99 tier. Support is the product in this category — every five-star review across all five apps is about a human solving a config problem quickly. $9/month cannot fund that.

**"All features unlocked" has unbounded cost.** Flat rules are nearly free to serve. Distance-based rates are not — every geocode and route lookup is a paid API call, which is exactly why Zapiet meters per rate calculation with $0.05–$0.10 overage. Mitigate with a fair-use cap in the terms of service and aggressive geocode caching. Same applies to AI assistant calls.

**Metering constraint.** Annual subscriptions do not support usage billing. If you ever add metered distance or AI usage, it can only live on the monthly plan. Know this before committing to the annual tier.

**Leave room for a higher tier.** A single plan means no expansion revenue — a five-product shop and a Plus store doing 200k rate calls pay identically. Name the plan "Pro" rather than "Unlimited" and avoid promising unlimited anything in listing copy. Shopify does not version plans for you; developers must handle retired-plan messaging themselves. Generic naming lets you introduce a higher tier later without breaking a promise.

### 6.4 Discount math

"2 months free" on a $29 plan = $290/year, a 16.7% discount. Comparison: ShipX and Zapiet offer 10%, SMART offers 20%. Present it as "2 months free" rather than a percentage — it converts better.

---

## 7. Build Sequence

1. **Foundation** — OAuth, embedded app shell, Polaris admin, GDPR webhooks, Shopify App Pricing
2. **Functions layer** — hide / rename / reorder with the condition set. Ships value on every Shopify plan.
3. **Rule builder UI** — IF/THEN, priority, duplicate, enable/disable
4. **Carrier Service engine** — flat, free, tiered, incremental, percentage, handling fee
5. **Zone and postal code system** — including UK/CA partial matching
6. **Test mode, simulator, rate log** — required for submission and for support
7. **Submit for review**
8. **Post-launch** — AI setup assistant, product groups, rate blending, CSV import/export
9. **Scale** — live carrier rates, distance engine, B2B, analytics

---

## 8. Positioning Summary

All five reference apps are strong on rule breadth and thin on proving the rules are correct. SMART bundles an activity log and simulator into its Pro tier; nobody leads with it. Zapiet uses AI for setup only.

**The wedge:** rate debugging plus shipping margin analytics, with AI applied to both setup *and* troubleshooting. "Here is exactly why this customer saw this price, and here is where you are losing money on shipping."

That is defensible against competitors with a decade head start on feature count.
