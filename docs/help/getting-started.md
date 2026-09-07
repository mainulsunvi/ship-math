# Getting started with ShipMath

This guide walks you through your first ten minutes with ShipMath. By the end, you will have a working shipping rule at your checkout.

## What does ShipMath do?

ShipMath changes how delivery options appear at your checkout. With it, you can:

- Hide delivery options you do not want to offer.
- Rename options so customers understand them better.
- Move options up or down the list.
- Replace a price with your own rate, like a flat fee or free shipping.

Think of it in two parts. A **zone** is a saved group of places, like "United Kingdom" or "everywhere". A **rule** is an instruction that says: when an order matches my conditions, change the delivery options like this.

[Add ShipMath Dashboard Screenshot]

## Step 1: Open ShipMath

1. Install ShipMath from the Shopify App Store, if you have not already.
2. In your Shopify admin, click **Apps** on the left.
3. Click **ShipMath**.

You will land on the Dashboard. It lists your rules and shows two helpful cards: the **Checkout Function status** card at the top, and the **Environment** card with the rules below it.

There is nothing to configure before you start. You can build your first rule right away.

## Step 2: Try the sample rules (optional)

Would you like to see finished rules before building your own? ShipMath can create a few examples for you:

1. Find the **Checkout Function status** card at the top of the Dashboard.
2. Click **Add sample rules**.

ShipMath adds a small set of starter rules. Open any of them to see how it is built, change anything you like, or delete them later. If you prefer to start from a clean slate, skip this step.

[Add Sample Rules Button Screenshot]

## Step 3: Create your first zone

A zone tells your rules where to apply. Rules do not need a zone, but zones keep things tidy once you have more than one rule.

1. Click **Zones** in the app menu at the top.
2. Create a new zone. A form opens.
3. Give it a clear name, like `UK only`.
4. Pick at least one country. You can also pick provinces or add postal codes.
5. Make sure the zone is switched on, then save.

The full guide is [Zones](zones.md).

[Add New Zone Form Screenshot]

## Step 4: Create your first rule

Here is where it all comes together. A rule is like a sentence: **IF** the order matches my conditions, **THEN** change the delivery options like this.

1. On the Dashboard, click **New rule**. A form opens on its own page.
2. In the **Basics** section, type a name you will recognize later, like `Hide local pickup`.
3. Set the priority. Lower numbers run first. Leave it as it is if you are not sure.
4. Choose the zone from step 3, or leave the zone empty to apply everywhere.
5. In the **IF** section, add a condition if you want the rule to apply only to some orders. For example: cart total is greater than 100. No conditions means the rule applies to every order.
6. In the **THEN** section, pick what should happen:
   - **Hide**: remove options whose title contains certain words.
   - **Rename**: change the title customers see.
   - **Move**: move an option earlier or later in the list.
   - **Carrier rate**: replace the price with your own flat, free, tiered, or percentage rate.
7. Click **Save**.

The full guide is [Shipping rules](rules.md).

[Add New Rule Form Screenshot]

## Step 5: Send your changes to the checkout

Your saved rules live in the app. The checkout reads its own copy of them. **Syncing** means sending your latest changes to that copy.

Good news: ShipMath syncs automatically after almost every action. The **Checkout Function status** card shows when the checkout last received your rules. If a sync ever fails, a banner appears with a **Retry sync** button, and your changes are still saved.

The full guide is [Syncing your changes](sync.md).

[Add Sync Status Card Screenshot]

## Step 6: Check the checkout

Place a test order that matches your rule and look at the delivery options. Do you see your change? Then you are done!

If nothing changed, check the three usual suspects:

1. **Test mode** is on. Your rules do nothing at checkout while it is on. See [Test mode and evaluation mode](test-mode.md).
2. The **sync failed**. Look for a red banner on the Dashboard and click **Retry sync**.
3. The rule or its zone is **switched off**. Check the switches in the rules table.

## What to read next

- [Zones](zones.md): target the right destinations.
- [Shipping rules](rules.md): master conditions and actions.
- [FAQ](faq.md): uninstalling, limits, and safety questions.

## Video tutorial

[Add Getting Started Video Tutorial]

A short video that follows this exact guide is on the way. It will appear right here when it is ready.
