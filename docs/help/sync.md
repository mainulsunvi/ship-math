# Syncing your changes to the checkout

ShipMath keeps your rules in two places, and syncing is the bridge between them:

1. **The app**: every zone and rule you save will be stored here. This is the complete copy.
2. **The checkout**: a small configuration that Shopify reads when it shows delivery options. This is a copy of your rules.

**Syncing** means sending your latest changes from the app to the checkout. Until a change is synced, the checkout will keep using your previous rules.

You will almost never have to press anything, because syncing is automatic. You only need to understand this page if a warning or banner ever appears.

[Add Checkout Function Status Card Screenshot]

## Reading the status card

The **Checkout Function Status** card sits at the top of the Dashboard. Each line tells you something useful:

- **Delivery customization owner**: this is the checkout side of ShipMath. It will say "No owner yet" until your first sync creates it, and after that it will turn into a green badge.
- **Function rules enabled**: how many of your rules are live at checkout right now.
- **Last synced**: when the checkout last received your rules. "never" means no sync has happened yet.
- **Config budget**: how much space your configuration uses. The checkout cannot read past this limit, so the card will show a progress bar. If the bar stays well short of full, the health line will show **Good**.

[Add Config Budget Progress Bar Screenshot]

## Automatic sync

You will not normally need to press anything. ShipMath will sync after you:

- create, edit, enable, disable, reorder, or delete a rule.
- create, edit, enable, disable, or delete a zone.
- change the evaluation mode.

Each sync takes a moment. When it finishes, the **Last synced** time will update.

## When a sync fails

If the push to the checkout fails, for example during a brief connection problem, two things will happen:

1. Your change will **still be saved** in the app. Nothing will be lost.
2. A red banner will appear on the Dashboard:

> **Checkout mirror out of date.** The change was saved to the database, but pushing it to the checkout Function failed.

Click **Retry sync** on the banner, or use the sync button on the Dashboard, and your checkout will catch up. That is all there is to it.

[Add Sync Failed Banner Screenshot]

## The stale warning

An orange banner saying the configuration changed since the last sync means the checkout is still using your previous rules. One sync will fix it. You will see this if a previous automatic push failed and has not been retried yet.

## Warnings after a successful sync

Sometimes a sync succeeds but could not carry everything. When that happens, ShipMath will tell you exactly what was left behind:

- **Truncated details**: a long piece of optional text was shortened to fit the checkout's size limit. The rule will still work, but some preview text was trimmed.
- **Excluded rules**: a rule did not fit in the configuration at all, so it will be **not active at checkout**. It is not deleted, and it will stay in your rules table. Remove or switch off other rules to free up space, then sync again, and the rule will become active at checkout.

When you see one of these warnings, everything you saved is safe. The warning only means that a small part did not fit into the copy the checkout uses.

[Add Sync Warnings Screenshot]

## Keeping the budget healthy

The checkout has a fixed size limit, shown as **Config budget** on the status card. Two habits will keep you comfortable:

1. Delete or switch off rules you no longer use.
2. Keep rule names, option titles, and rate names short.

The dashboard also shows how many rules are enabled against a soft cap. If you ever reach the cap, extra rules will be flagged in the sync warnings. Nothing will ever be deleted silently.

## Video tutorial

[Add Syncing Video Tutorial]

A syncing walkthrough, including failed syncs and warnings, is on the way. It will appear right here when it is ready.
