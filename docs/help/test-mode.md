# Test mode and evaluation mode

ShipMath has two settings that change **how** your rules behave:

- **Test mode** keeps your rules away from real checkouts while you build.
- **Evaluation mode** decides how many rules will apply to a single order.

There is one test mode switch, and you will find it in Settings, inside the **Go Live** card. The Dashboard will only show whether test mode is on or off; to change it, you will go to Settings.

[Add Settings Page Screenshot]

## Test mode: practice without touching the checkout

When test mode is **on**, ShipMath will do nothing at checkout. Your customers will see normal shipping options, exactly as if ShipMath were not there. Your rules will not be lost; they will just wait.

Turn test mode on when you:

- are building your first rules and are not sure they are right yet.
- want to try a risky change, like hiding options during a carrier outage.
- are copying a setup from another store and want to check it first.

The **Go live** card will always show the current state:

- The **Test mode** switch will show whether test mode is on or off, and you will click it to change it.
- The badge at the top of the card will tell you more: **Test mode**, **Not live yet**, or **Live (carrier rates on)**.

> **Remember to switch back.** While test mode is on, your rules will do nothing at checkout. If your store looks "fine but unchanged" after a big setup session, check this switch first.

## How to use test mode, step by step

### Step 1: Turn test mode on

1. Click **Settings** in the app menu at the top.
2. Find the **Go live** card.
3. Click the **Test mode** switch, and it will turn on.
4. The badge at the top of the card will change to **Test mode**.

[Add Test Mode Switch On Screenshot]

### Step 2: Build or change your rules

Work on the Dashboard as usual. You can create zones, create rules, edit or delete anything you like. Every change will be saved and sent to the checkout the same way as always. The difference: while test mode is on, the checkout will hold your rules but will not use them. Nothing you do will affect what your customers see.

### Step 3: Check your work

While test mode is on, the checkout cannot show you your rules, so use the [rate simulator](simulator.md) instead:

- Open **Simulator** in the app menu. Pick real products or type cart lines, fill in a checkout-style destination, and click **Run simulation**. ShipMath will run your rules exactly as checkout will, and the results will show the rates and the changes your rules would produce.
- Read the rule-by-rule trace in the results: a green badge means the rule matched, a gray one means it did not, and ShipMath will tell you why. This is the fastest way to spot a condition that says the opposite of what you meant.
- Open each rule on the Rules page and read it back as a sentence: when this happens, do that. If the sentence does not match what you want, edit the rule.
- In the rules table, confirm the right rules are switched on and the priority numbers run in the order you expect. Lower numbers will run first.

The simulator works exactly the same with test mode on or off. Every run will be saved on the [Request log](logs.md) page, so you can compare runs after you change a rule.

[Add Rate Simulator Screenshot]

### Step 4: Go back to live

1. Return to **Settings** and click the **Test mode** switch so it turns off.
2. If you use carrier rate rules, press **Go live** in the same card.
3. Place a test order: start a checkout as a customer would, look at the delivery options, then close the page before paying.
4. If something looks wrong, switch test mode back on, fix the rule, and try again. You can repeat this as many times as you like.

[Add Live Checkout Test Screenshot]

## Going live with carrier rates

Carrier rate rules work a little differently from the other kinds: during checkout, Shopify will ask ShipMath directly for a price. For your prices to show up, you need two things:

1. **Test mode is off.**
2. You pressed **Go live** in Settings, so ShipMath is registered with your store's checkout.

While you are live, the card will show the badge **Live (carrier rates on)**, and customers will see the prices from your carrier rate rules.

You can stop serving rates in two ways:

- **Switch test mode on**, and ShipMath will stay connected but serve no rates. Switch it off again, and your rates will come back.
- Press **Enter test mode**, and ShipMath will remove itself from your checkout completely. To serve rates again, switch test mode off and press **Go live**.

Carrier rate rules will not need a sync, because Shopify reads your rates live. Hide, rename, and move rules will still sync to the checkout as described in [Syncing your changes](sync.md).

[Add Go Live Card Screenshot]

[Add Test Mode On Screenshot]

## Evaluation mode: one rule or many?

The **Evaluation mode** dropdown has two options, and picking the right one will make your rules behave the way you expect.

### First match wins

Only one rule will apply per order: the matching rule with the lowest priority number. Everything else will be ignored for that order.

**Example**: you have one rate rule per region, like "UK rate", "EU rate", "US rate". An order will match only one region, and exactly one rule will apply. This is the mode for that.

### All matches apply

Every matching rule will apply, in priority order. This lets rules do different jobs on the same order: one rule will rename an option while another sets a special price.

**Example**: rule 1 renames your standard option to "EasyPak Standard", and rule 2 gives free shipping over 50. A big order will match both, and that is exactly what you want.

### Stop on match

In "all matches" mode, each rule has a **Stop on match** switch. When a rule with this switch turned on fires, the rules below it will be skipped. Use it for a "premium handling" rule that will always win over the rules below it.

[Add Evaluation Mode Dropdown Screenshot]

## Priority, one more time

In both modes, priority decides the order in which rules will be considered. Lower numbers will run first: priority 1 will run before priority 5. You can use the priority arrows in the rules table to reorder without opening each rule.

## Video tutorial

[Add Test Mode Video Tutorial]

A video covering both modes, with a full test mode walkthrough, is on the way. It will appear right here when it is ready.
