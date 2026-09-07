# Test mode and evaluation mode

ShipMath has two switches that change **how** your rules behave. They sound similar but do very different jobs:

- **Test mode** keeps your rules away from real checkouts while you build.
- **Evaluation mode** decides how many rules can apply to a single order.

Both live in the **Environment** card on the Dashboard, and test mode is also shown in the Checkout Function status card.

[Add Environment Card Screenshot]

## Test mode: practice without touching the checkout

When test mode is **on**, the checkout applies **no operations**. Your customers see normal shipping options, exactly as if ShipMath were not there. Your rules are not lost; they are just waiting.

Turn test mode on when you:

- Are building your first rules and are not sure they are right yet.
- Want to try a risky change, like hiding options during a carrier outage.
- Are copying a setup from another store and want to check it first.

The button label changes with the state, so you always know where you stand:

- **Turn on test mode** is shown while you are live.
- **Go live** is shown while you are testing.

> **Remember to switch back.** While test mode is on, your rules do nothing at checkout. If your store looks "fine but unchanged" after a big setup session, check this switch first.

[Add Test Mode On Screenshot]

## Evaluation mode: one rule or many?

The **Evaluation mode** dropdown has two options, and picking the right one makes your rules behave the way you expect.

### First match wins

Only one rule applies per order: the matching rule with the lowest priority number. Everything else is ignored for that order.

**Example**: you have one rate rule per region, like "UK rate", "EU rate", "US rate". An order matches only one region, and exactly one rule should apply. This is the mode for that.

### All matches apply

Every matching rule applies, in priority order. This lets rules do different jobs on the same order: one rule renames an option while another sets a special price.

**Example**: rule 1 renames your standard option to "EasyPak Standard", and rule 2 gives free shipping over 50. A big order can match both, and that is exactly what you want.

### Stop on match

In "all matches" mode, each rule has a **Stop on match** switch. When a rule with it enabled fires, the rules below it are skipped. Use it for a "premium handling" rule that should win over everything below it, no matter what.

[Add Evaluation Mode Dropdown Screenshot]

## Priority, one more time

In both modes, priority decides the order in which rules are considered. Lower numbers run first: priority 1 runs before priority 5. Use the priority arrows in the rules table to reorder without opening each rule.

## A safe testing workflow

1. Turn on **test mode**.
2. Build your zones and rules.
3. Preview them in the simulator.
4. Fix anything that looks wrong.
5. Press **Go live** to switch test mode off.
6. Sync, then place a test order at checkout to confirm.

## Video tutorial

[Add Test Mode Video Tutorial]

A video covering both modes, with a full safe-testing workflow, is on the way. It will appear right here when it is ready.
