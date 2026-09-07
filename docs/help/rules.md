# Shipping rules: control what customers see at checkout

A rule is an instruction with two parts. **IF** an order matches your conditions, **THEN** ShipMath changes the delivery options.

You might use a rule to hide an expensive express option for small orders, to give free shipping over a certain total, or to rename "Standard Shipping" into something friendlier. Rules are powerful, but each one is just a sentence: when this happens, do that.

Rules live on the **Dashboard**. You create and edit each rule on its own page, and every rule has a short ID so you can always find it again.

[Add Rules Table Screenshot]

## The four things a rule can do

| Kind | What it does | Example |
| --- | --- | --- |
| **Hide** | Removes delivery options whose title contains certain words. The match ignores capital letters, so `express` also matches "Express Shipping". | Hide every option with the word "pickup". |
| **Rename** | Replaces the title customers see. | "Standard Shipping" becomes "EasyPak Standard, 3 to 5 days". |
| **Move** | Changes the position of a delivery option in the list. Smaller numbers move it earlier. | Move your cheapest option to the first place. |
| **Carrier rate** | Replaces the option's price with your own rate. | A flat 5.00 fee, free shipping over 50, or price bands by weight. |

## Create a rule

1. On the Dashboard, click **New rule**. The rule form opens on its own page.
2. Fill in the **Basics**:
   - **Name**: anything you will recognize later.
   - **Priority**: lower numbers run first. Priority 1 runs before priority 5.
   - **Zone**: optional. Narrow the rule to a saved group of destinations. See [Zones](zones.md). Leave it empty and the rule applies everywhere.
3. Add conditions in the **IF** section, if the rule should apply only to some orders. See the next section.
4. Choose and configure the action in the **THEN** section.
5. Click **Save**.

ShipMath saves your rule and sends it to the checkout automatically. Banners on the Dashboard tell you if a sync needs attention. See [Syncing your changes](sync.md).

[Add New Rule Page Screenshot]

## Conditions: the IF part

Conditions decide when a rule fires. You can build conditions about the **cart**, like totals, item counts, and weight, about the **products** inside it, and about the **customer**.

### Adding a condition

Click **Add condition** and a searchable picker opens. Conditions are grouped by category, and every entry explains what it matches in one line. Type a few letters to filter the list.

[Add Condition Picker Screenshot]

### AND or OR: choose how conditions combine

At the top of the IF section, you choose how the conditions work together:

- **Match all** (AND): every condition must be true. "Total over 100 AND weight under 5 kg" fires only when both are true.
- **Match any** (OR): at least one condition must be true. "Total over 100 OR customer tag VIP" fires when either one is true.

### Nesting groups (advanced, but easy)

Click **Add group** to put a whole group of conditions inside another group. Groups can nest up to three levels deep. Here is a real example:

> Total over 100, AND (destination is a metro area OR weight under 5 kg)

In words: big orders qualify, unless they are heavy and going somewhere far. The bracketed part is a nested group set to match any.

[Add Nested Group Screenshot]

A rule with **no conditions** matches every order. That is often exactly what you want for a simple hide or rename.

## The action: the THEN part

### Hide

Type the words to look for in delivery option titles. Any option whose title contains those words is hidden at checkout.

### Rename

Type the new title customers will see.

### Move

Type the new position. Smaller numbers move the option earlier. If you type a negative number, ShipMath corrects it to 0, which means the first place.

### Carrier rate

This kind replaces the option's price with your own rate:

- **Mode**: flat (one price), free (zero), tiered (price bands by weight, cart subtotal, or item quantity), or percentage (a share of the original price).
- **Service name**: shown to customers as the rate name.
- **Service code**: a stable code used by the carrier callback. Your carrier or integration uses it to recognize the rate.
- **Tiers**: for tiered mode, each band has a ceiling and a price. The last band can be open-ended. You can also make the first N items free and set a maximum total rate.

One restriction to know: carrier rate rules cannot use conditions based on tags or customer identity, because the carrier data carries no such information. The form warns you if a condition cannot be used.

[Add Carrier Rate Action Screenshot]

## Every rule has a short ID

Each rule gets a short unique ID when it is created. You can see it on the edit page, and it is also part of the page address. Bookmark a rule you edit often, or quote its ID when asking for help, and there will be no doubt about which rule you mean.

[Add Rule Edit Page With ID Screenshot]

## Managing your rules

Every row in the rules table has actions:

- **Edit**: opens the rule's own page.
- **Duplicate**: copies the rule and slots it next to the original. Perfect as a starting point for similar rules.
- **Delete**: asks you to confirm first. Deleted rules are gone for good.

The table also gives you quick controls:

- The **Enabled** switch turns a rule on or off without deleting it.
- The **Priority** arrows reorder rules. Remember, lower numbers run first.

[Add Rule Row Actions Screenshot]

## How rules work together

The **Evaluation mode** dropdown in the Environment card decides how many rules can apply to one order:

- **First match wins**: only the lowest-priority matching rule applies.
- **All matches apply**: every matching rule applies, in priority order. Each rule also has a **Stop on match** switch. When a rule with it enabled fires, the rules below it are skipped.

The full explanation, with examples, is in [Test mode and evaluation mode](test-mode.md).

## Video tutorial

[Add Shipping Rules Video Tutorial]

A rule-building walkthrough, including conditions and every action kind, is on the way. It will appear right here when it is ready.
