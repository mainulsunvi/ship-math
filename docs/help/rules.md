# Shipping rules: control what customers see at checkout

A rule is an instruction in one sentence: **IF** an order matches your conditions, **THEN** ShipMath will change the delivery options, and optionally **ELSE** it will do something different when the conditions do not match.

You might use a rule to hide an expensive express option for small orders, to give free shipping over a certain total, or to rename "Standard Shipping" into something friendlier. Rules are powerful, but each one is just a sentence: when this happens, do that.

Rules live on the **Rules** page. You will create and edit each rule on its own page, and every rule will have a short ID so you can always find it again. The Dashboard shows the same rules table, so you can manage your rules from either place.

[Add Rules Table Screenshot]

## The four things a rule can do

| Kind | What it will do | Example |
| --- | --- | --- |
| **Hide** | Removes delivery options by title match, or by price rank (cheapest or most expensive). Show-only modes keep the rates you want and hide the rest. | Show only the cheapest rate, or hide every option with the word "pickup". |
| **Rename** | Replaces the title customers see. | "Standard Shipping" will become "EasyPak Standard, 3 to 5 days". |
| **Move** | Changes the position of a delivery option in the list. Smaller numbers move it earlier. | Move your cheapest option to the first place. |
| **Carrier rate** | Replaces the option's price with your own rate. | A flat 5.00 fee, free shipping over 50, or price bands by weight. |

## Create a rule

1. On the **Rules** page, click **New rule**. The rule form will open on its own page.
2. Fill in the **Basics**: a name you will recognize later, a priority (lower numbers run first, so priority 1 will run before priority 5), and an optional zone to narrow the rule to a saved group of destinations. See [Zones](zones.md). If you leave the zone empty, the rule will apply everywhere.
3. Add conditions in the **Conditions** card if the rule should apply only to some orders. Click **Add condition**, pick a field from the catalog window, set the operator and the value, and click **Add condition** to save it. Every condition will appear as a small chip you can edit or remove at any time. The next section explains the fields.
4. Build the **Then** card: click **Add action**, choose what the rule does (hide, rename, move, or set a shipping rate), fill in the details, and click **Add action** to save. You can stack several actions, and they will run in the order you see them.
5. Optional: fill the **Else** card with actions that run when the conditions do not match. A rule with no else actions will simply do nothing on a miss.
6. Click **Save**.

ShipMath will save your rule and send it to the checkout automatically. If a sync needs attention, banners on the Rules page and the Dashboard will tell you. See [Syncing your changes](sync.md).

[Add New Rule Page Screenshot]

## Conditions: the IF part

Conditions decide when a rule fires. You can build conditions about the **cart**, like totals, item counts, and weight, about the **products** inside it, about the **customer**, and about the **date and time** of the order.

### Adding a condition

Click **Add condition** and a searchable catalog window will open. The fields will be grouped by category, and every entry will explain what it matches in one line. Type a few letters and the list will narrow down. After you pick a field, the same window will show the operator and value for it, so everything about a condition lives in one place.

Saved conditions will show up as chips under the match type. Click the pencil on a chip to change it, or the trash to remove it.

[Add Condition Picker Screenshot]

### The fields you can pick

| Category | Fields | Notes |
| --- | --- | --- |
| **Cart** | Subtotal, Total, Item quantity, Total weight | Total includes taxes and discounts, subtotal does not. The carrier lane sees the pre-discount subtotal. |
| **Product** | Item price, SKU, Vendor, Product tag | Item price matches when any single line item satisfies the condition. |
| **Customer** | Customer tag, Login status, City | Login status checks whether the buyer is signed in. City comes from the delivery address. |
| **Date and time** | Date, Day of the week, Time of day | Kept in your shop's time zone setting. See the note below. |

### A note on date and time

Checkout delivery customization runs in a space with no clock, so date and time conditions cannot run there. Rules that use them will still run fully in the **carrier lane** and in the **simulator**, and the sync banner will remind you about the checkout gap. If you need a date or time rule to also change checkout options, split it into a second rule without those conditions.

### All, any, or none: choose how conditions combine

At the top of the Conditions card, you choose how the conditions work together:

- **All conditions must match** (AND): every condition must be true. "Total over 100 AND weight under 5 kg" will fire only when both are true.
- **Any condition can match** (OR): at least one condition must be true. "Total over 100 OR customer tag VIP" will fire when either one is true.
- **None of the conditions match**: the rule will fire only when every condition is false. "None of: total under 20, customer tag guest" will match every order that is at least 20 and does not carry the guest tag. A group with no conditions under "none" counts as a match.

### Nesting groups (advanced, but easy)

Click **Add group** to put a whole group of conditions inside another group. Groups can nest up to three levels deep. Here is a real example:

> Total over 100, AND (customer tag is VIP OR weight under 5 kg)

In words: this rule will apply to big orders, but only if the customer is a VIP or the order is light. The part in brackets is a group inside the rule, and it will be true when either side of it is true. Nested groups combine with **all** or **any**; the "none" choice is only available for the top level.

[Add Nested Group Screenshot]

A rule with **no conditions** will match every order. That is often exactly what you want for a simple hide or rename.

## The actions: the THEN and ELSE parts

When the conditions match, the **Then** actions will run, in the order they appear. Click the pencil on an action chip to change it, or the trash to remove it. You can stack as many as you need: hide pickup, then rename standard, then move express to the top, all in one rule.

Two things to keep in mind:

The first action you add decides what the whole rule does, so there is no separate kind dropdown: pick hide, rename, or move in the action window and the rule becomes that kind. Every action in the rule then makes the same kind of change. A hide rule can hide several things, but it cannot rename. Stack rules to mix. To start over, remove every action: the next action you add will ask again what the rule should do.
- Two renames on the same option: the later action wins, because it simply writes over the earlier one.

When the conditions do not match, the **Else** actions will run instead. Else actions are optional, they use the same editor, and they never stop later rules from running: a rule with stop on match turned on will only halt the queue when it actually matches. In "first match wins" mode, an else action alone will never claim the win, so the first real match below it still applies.

[Add Then And Else Cards Screenshot]

### Hide

Hide rules now offer a **Targeting** choice, so you can hide exactly what you want:

- **Hide matching rates**: the classic mode. Type the words to look for in delivery option titles, and any option whose title contains those words will be hidden. The match ignores capital letters.
- **Show only matching rates (hide the rest)**: keep the rates whose titles contain your words, and hide everything else. New rates that appear later and do not match will be hidden automatically.
- **Show only the cheapest rate (hide the rest)**: hide every rate except the one with the lowest price. Great for a clean, single-option checkout.
- **Show only the most expensive rate (hide the rest)**: the same idea, keeping the highest price.
- **Hide the cheapest rate** and **Hide the most expensive rate**: hide just the cheapest or most expensive option, and leave the rest alone.

The rank modes (cheapest and most expensive) pick by the prices checkout shows, including rates from other apps. If a price is not known, that rate never counts as the cheapest or most expensive.

[Add Hide Targeting Screenshot]

### Rename

Type the new title, and customers will see it in place of the old one.

### Move

Type the new position. Smaller numbers will move the option earlier. If you type a negative number, ShipMath will correct it to 0, which means the first place.

### Carrier rate

Carrier rate rules open a **Rate** card instead of the Then and Else cards, because a rate is one price, not a list of actions.

This kind will replace the option's price with your own rate:

- **Mode**: flat (one price), free (zero), tiered (price bands by weight, cart subtotal, or item quantity), or percentage (a share of the original price).
- **Service name**: customers will see this as the rate name at checkout.
- **Service code**: a short label that identifies this rate to Shopify. Give each of your carrier rate rules a different code.
- **Tiers**: for tiered mode, each band has a ceiling and a price, and the last band can be open-ended. You can also make the first N items free and set a maximum total rate.

One restriction to know: carrier rate rules cannot use conditions based on tags or customer identity, because the carrier data carries no such information. The condition catalog will hide those fields while you edit a carrier rate rule, and any condition the form cannot use will be flagged.

Carrier rates will reach the checkout only when your store is live: turn test mode off and press **Go live** on the [Settings](test-mode.md#going-live-with-carrier-rates) page. Hide, rename, and move rules will take effect after a sync instead.

[Add Carrier Rate Action Screenshot]

## Choosing fields: Basic today, more coming

When you open the condition catalog you will pick between two tiers:

- **Basic** (selected): the cart, product, customer, and date and time fields described above.
- **Advanced** (coming soon): line item properties, discount codes, and more.

Basic covers the fields stores ask for most. When Advanced lands, your existing rules will keep working unchanged.

## Every rule has a short ID

Each rule gets a short unique ID when it is created. You will see it on the edit page, and it is also part of the page address. Bookmark a rule you edit often, or quote its ID when asking for help, and there will be no doubt about which rule you mean.

[Add Rule Edit Page With ID Screenshot]

## Managing your rules

Every row in the rules table has actions:

- **Edit** will open the rule's own page.
- **Duplicate** will copy the rule and slot it next to the original, which makes it a perfect starting point for similar rules.
- **Delete** will ask you to confirm first, and deleted rules are gone for good.

The table also gives you quick controls. The **Enabled** switch will turn a rule on or off without deleting it, and the **Priority** arrows will reorder rules. Remember, lower numbers run first.

The rule's own page carries the same control in the **Rule Status** card on the right side, so you can flip a rule on or off while you edit it. The badge next to the title will show **Active** or **Inactive**, and flipping the switch will not touch your unsaved edits.

[Add Rule Row Actions Screenshot]

## How rules work together

The **Evaluation mode** dropdown in the Environment card decides how many rules can apply to one order:

- **First match wins**: only the lowest-priority matching rule will apply.
- **All matches apply**: every matching rule will apply, in priority order. Each rule also has a **Stop on match** switch. When a rule with this switch turned on fires, the rules below it will be skipped.

The full explanation, with examples, is in [Test mode and evaluation mode](test-mode.md).

## Preview with the simulator

Before you trust a rule at checkout, you can watch it run. Open the [Simulator](simulator.md) page, build a pretend cart, and ShipMath will show you what your rules would do, without a real order anywhere in sight.

The simulator will accept:

- **Cart lines**: picked from your catalog with real prices and weights, or typed in by hand, with optional SKUs, vendors, and product tags for the conditions that look at them.
- **Destination**: a full checkout-style address form, with a shortcut that fills the country from one of your Shopify shipping zones.
- **Location and customer**: a pickup location, plus a guest, a dummy tagged tester, or one of your real customers with their tags.
- **Which rules run**: every rule by default, or just the ones you tick, which is the fastest way to debug a single rule.

Click **Run simulation** and the results will show three things:

- **Carrier rates returned**: the prices your carrier rate rules would hand to checkout for that cart.
- **Delivery Option Changes**: the hides, renames, and moves checkout would apply.
- **A rule-by-rule trace**: every rule in both lanes with a badge. Green means it matched (and, for carrier rules, produced a rate); gray means it did not, with the exact condition or zone that stopped it.

The simulator runs the exact same engine checkout uses, so what you see is what customers would get. Test mode changes nothing here: while test mode is on, live checkout will apply nothing, and the simulator will keep previewing. Every run will be saved on the [Request log](logs.md) page. The full walkthrough lives in [The rate simulator](simulator.md).

[Add Rate Simulator Screenshot]

## Video tutorial

[Add Shipping Rules Video Tutorial]

A rule-building walkthrough, including conditions and every action kind, is on the way. It will appear right here when it is ready.
