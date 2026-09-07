# Syncing your changes to the checkout

ShipMath keeps your rules in two places, and syncing is the bridge between them:

1. **The app**: every zone and rule you save is stored here. This is your master copy.
2. **The checkout**: a small configuration that Shopify reads when it shows delivery options. This is a copy of your rules.

**Syncing** means sending your latest changes from the app to the checkout. Until a change is synced, the checkout keeps using your previous rules.

The good news: almost everything is automatic. You only need to understand this page if a warning or banner ever appears.

[Add Checkout Function Status Card Screenshot]

## Reading the status card

The **Checkout Function status** card sits at the top of the Dashboard. Each line tells you something useful:

- **Delivery customization owner**: the checkout side of ShipMath. It says "No owner yet" until your first sync creates it. After that, it turns into a green badge.
- **Function rules enabled**: how many of your rules are live at checkout right now.
- **Last synced**: when the checkout last received your rules. "never" means no sync has happened yet.
- **Config budget**: how much space your configuration uses. The checkout cannot read past this limit, so the card shows a progress bar. Keep it out of the red and your health stays **Good**.

[Add Config Budget Progress Bar Screenshot]

## Automatic sync

You do not normally need to press anything. ShipMath syncs after you:

- Create, edit, enable, disable, reorder, or delete a rule.
- Create, edit, enable, disable, or delete a zone.
- Change the evaluation mode.

Each sync takes a moment. When it finishes, the **Last synced** time updates.

## When a sync fails

If the push to the checkout fails, for example during a brief connection problem, two things happen:

1. Your change is **still saved** in the app. Nothing is lost.
2. A red banner appears on the Dashboard:

> **Checkout mirror out of date.** The change was saved to the database, but pushing it to the checkout Function failed.

Click **Retry sync** on the banner, or use the sync button on the Dashboard, and your checkout catches up. That is all there is to it.

[Add Sync Failed Banner Screenshot]

## The stale warning

An orange banner saying the configuration changed since the last sync means the checkout is still using your previous rules. One sync fixes it. You will see this if a previous automatic push failed and has not been retried yet.

## Warnings after a successful sync

Sometimes a sync succeeds but could not carry everything. ShipMath tells you exactly what was left behind:

- **Truncated details**: a long piece of optional text was shortened to fit the checkout's size limit. The rule still works; some preview text was trimmed.
- **Excluded rules**: a rule did not fit in the configuration at all, so it is **not active at checkout**. It is not deleted. It is still in your rules table. Free up some space, sync again, and it comes back.

Read these warnings when they appear. They are the app's way of saying: everything was saved, slightly less was carried.

[Add Sync Warnings Screenshot]

## Keeping the budget healthy

The checkout has a fixed size limit, shown as **Config budget** on the status card. Two habits keep you comfortable:

1. Delete or switch off rules you no longer use.
2. Keep rule names, option titles, and rate names short.

The dashboard also shows how many rules are enabled against a soft cap. If you ever reach the cap, extra rules would be flagged in the sync warnings. Nothing is ever deleted silently.

## Video tutorial

[Add Syncing Video Tutorial]

A syncing walkthrough, including failed syncs and warnings, is on the way. It will appear right here when it is ready.
