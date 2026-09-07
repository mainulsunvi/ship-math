# Shipping rules: control what customers see at checkout

A rule is an instruction with two parts: **IF** an order matches your conditions, **THEN** ShipMath will change the delivery options.

You might use a rule to hide an expensive express option for small orders, to give free shipping over a certain total, or to rename "Standard Shipping" into something friendlier. Rules are powerful, but each one is just a sentence: when this happens, do that.

Rules live on the **Dashboard**. You will create and edit each rule on its own page, and every rule will have a short ID so you can always find it again.

[Add Rules Table Screenshot]

## The four things a rule can do

| Kind | What it will do | Example |
| --- | --- | --- |
| **Hide** | Removes delivery options whose title contains certain words. The match ignores capital letters, so `express` will also match "Express Shipping". | Hide every option with the word "pickup". |
| **Rename** | Replaces the title customers see. | "Standard Shipping" will become "EasyPak Standard, 3 to 5 days". |
| **Move** | Changes the position of a delivery option in the list. Smaller numbers move it earlier. | Move your cheapest option to the first place. |
| **Carrier rate** | Replaces the option's price with your own rate. | A flat 5.00 fee, free shipping over 50, or price bands by weight. |

## Create a rule

1. On the Dashboard, click **New rule**. The rule form will open on its own page.
2. Fill in the **Basics**: a name you will recognize later, a priority (lower numbers run first, so priority 1 will run before priority 5), and an optional zone to narrow the rule to a saved group of destinations. See [Zones](zones.md). If you leave the zone empty, the rule will apply everywhere.
3. Add conditions in the **IF** section if the rule should apply only to some orders. The next section explains how.
4. Choose and configure the action in the **THEN** section.
5. Click **Save**.

ShipMath will save your rule and send it to the checkout automatically. If a sync needs attention, banners on the Dashboard will tell you. See [Syncing your changes](sync.md).

[Add New Rule Page Screenshot]

## Conditions: the IF part

Conditions decide when a rule fires. You can build conditions about the **cart**, like totals, item counts, and weight, about the **products** inside it, and about the **customer**.

### Adding a condition

Click **Add condition** and a searchable picker will open. The conditions will be grouped by category, and every entry will explain what it matches in one line. Type a few letters and the list will narrow down.

[Add Condition Picker Screenshot]

### AND or OR: choose how conditions combine

At the top of the IF section, you choose how the conditions work together:

- **Match all** (AND): every condition must be true. "Total over 100 AND weight under 5 kg" will fire only when both are true.
- **Match any** (OR): at least one condition must be true. "Total over 100 OR customer tag VIP" will fire when either one is true.

### Nesting groups (advanced, but easy)

Click **Add group** to put a whole group of conditions inside another group. Groups can nest up to three levels deep. Here is a real example:

> Total over 100, AND (customer tag is VIP OR weight under 5 kg)

In words: this rule will apply to big orders, but only if the customer is a VIP or the order is light. The part in brackets is a group inside the rule, and it will be true when either side of it is true.

[Add Nested Group Screenshot]

A rule with **no conditions** will match every order. That is often exactly what you want for a simple hide or rename.

## The action: the THEN part

### Hide

Type the words to look for in delivery option titles. Any option whose title contains those words will be hidden at checkout.

### Rename

Type the new title, and customers will see it in place of the old one.

### Move

Type the new position. Smaller numbers will move the option earlier. If you type a negative number, ShipMath will correct it to 0, which means the first place.

### Carrier rate

This kind will replace the option's price with your own rate:

- **Mode**: flat (one price), free (zero), tiered (price bands by weight, cart subtotal, or item quantity), or percentage (a share of the original price).
- **Service name**: customers will see this as the rate name at checkout.
- **Service code**: a short label that identifies this rate to Shopify. Give each of your carrier rate rules a different code.
- **Tiers**: for tiered mode, each band has a ceiling and a price, and the last band can be open-ended. You can also make the first N items free and set a maximum total rate.

One restriction to know: carrier rate rules cannot use conditions based on tags or customer identity, because the carrier data carries no such information. If you pick a condition the form cannot use, it will warn you.

Carrier rates will reach the checkout only when your store is live: turn test mode off and press **Go live** on the [Settings](test-mode.md#going-live-with-carrier-rates) page. Hide, rename, and move rules will take effect after a sync instead.

[Add Carrier Rate Action Screenshot]

## Every rule has a short ID

Each rule gets a short unique ID when it is created. You will see it on the edit page, and it is also part of the page address. Bookmark a rule you edit often, or quote its ID when asking for help, and there will be no doubt about which rule you mean.

[Add Rule Edit Page With ID Screenshot]

## Managing your rules

Every row in the rules table has actions:

- **Edit** will open the rule's own page.
- **Duplicate** will copy the rule and slot it next to the original, which makes it a perfect starting point for similar rules.
- **Delete** will ask you to confirm first, and deleted rules are gone for good.

The table also gives you quick controls. The **Enabled** switch will turn a rule on or off without deleting it, and the **Priority** arrows will reorder rules. Remember, lower numbers run first.

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
- **Function operations**: the hides, renames, and moves checkout would apply.
- **A rule-by-rule trace**: every rule in both lanes with a badge. Green means it matched (and, for carrier rules, produced a rate); gray means it did not, with the exact condition or zone that stopped it.

The simulator runs the exact same engine checkout uses, so what you see is what customers would get. Test mode changes nothing here: while test mode is on, live checkout will apply nothing, and the simulator will keep previewing. Every run will be saved on the [Request log](logs.md) page. The full walkthrough lives in [The rate simulator](simulator.md).

[Add Rate Simulator Screenshot]

## Video tutorial

[Add Shipping Rules Video Tutorial]

A rule-building walkthrough, including conditions and every action kind, is on the way. It will appear right here when it is ready.
