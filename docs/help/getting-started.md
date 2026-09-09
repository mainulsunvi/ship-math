# Getting started with ShipMath

This guide will walk you through your first ten minutes with ShipMath. By the end, you will have a working shipping rule at your checkout.

## What will ShipMath do for you?

ShipMath changes how delivery options appear at your checkout. After you set it up, you will be able to:

- hide delivery options you do not want to offer.
- rename options so customers understand them better.
- move options up or down the list.
- replace a price with your own rate, like a flat fee or free shipping.

You will work with two things. A **zone** is a saved group of places, like "United Kingdom" or "everywhere". A **rule** is an instruction: when an order matches your conditions, ShipMath will change the delivery options.

[Add ShipMath Dashboard Screenshot]

## Step 1: Open ShipMath

1. Install ShipMath from the Shopify App Store, if you have not already.
2. In your Shopify admin, click **Apps** on the left.
3. Click **ShipMath**.

You will land on the Dashboard. The **Checkout Function Status** card will sit at the top, and below it you will find the **Environment** card and the table with your rules.

There is nothing to configure before you start. You can build your first rule right away.

## Step 2: Try the sample rules (optional)

Would you like to see some finished rules before you build your own? ShipMath will create a few examples for you:

1. Find the **Checkout Function Status** card at the top of the Dashboard.
2. Click **Add sample rules**.

ShipMath will add a small set of starter rules within a moment. You can open any of them to see how it is built, change whatever you like, or delete them later. If you prefer to start from a clean slate, skip this step.

[Add Sample Rules Button Screenshot]

## Step 3: Create your first zone

A zone tells your rules where to apply. Rules do not need a zone, but zones will keep things tidy once you have more than one rule.

1. Click **Zones** in the app menu at the top.
2. Create a new zone. A form will open.
3. Give it a clear name, like `UK only`.
4. Pick at least one country. You can also pick provinces or add postal codes.
5. Make sure the zone is switched on, then save.

The full guide is [Zones](zones.md).

[Add New Zone Form Screenshot]

## Step 4: Create your first rule

Here is where it all comes together. A rule is like a sentence: **IF** the order matches your conditions, **THEN** ShipMath will change the delivery options.

1. On the Dashboard, click **New rule**. The form will open on its own page.
2. In the **Basics** section, type a name you will recognize later, like `Hide local pickup`.
3. Set the priority. Lower numbers run first, so priority 1 will run before priority 5. Leave it as it is if you are not sure.
4. Choose the zone from step 3, or leave the zone empty and the rule will apply everywhere.
5. In the **IF** section, add a condition if you want the rule to apply only to some orders. For example: cart total is greater than 100. If you add no conditions, the rule will apply to every order.
6. In the **THEN** section, pick what should happen. If you pick **Hide**, ShipMath will remove options whose title contains certain words. **Rename** will change the title customers see. **Move** will change the position in the list, and **Carrier rate** will replace the price with your own flat, free, tiered, or percentage rate.
7. Click **Save**.

ShipMath will save your rule and send it to the checkout automatically.

The full guide is [Shipping rules](rules.md).

[Add New Rule Form Screenshot]

## Step 5: Send your changes to the checkout

Your saved rules will live in the app, and the checkout will read its own copy of them. **Syncing** means sending your latest changes to that copy.

You will not have to press anything: ShipMath will sync automatically after almost every action. The **Checkout Function Status** card will show when the checkout last received your rules. If a sync ever fails, a banner will appear with a **Retry sync** button, and your changes will still be saved.

The full guide is [Syncing your changes](sync.md).

[Add Sync Status Card Screenshot]

## Step 6: Check the checkout

Place a test order that matches your rule and look at the delivery options. You should see your change. If you do, you are done!

If nothing changed, check these usual suspects:

1. **Test mode** is on. While it is on, your rules will do nothing at checkout. See [Test mode and evaluation mode](test-mode.md).
2. The **sync failed**. Look for a red banner on the Dashboard and click **Retry sync**.
3. The rule or its zone is **switched off**. Check the switches in the rules table.
4. It is a **carrier rate** rule and the store is not live yet. Press **Go live** in Settings. See [Going live with carrier rates](test-mode.md#going-live-with-carrier-rates).

## What to read next

- [Zones](zones.md) will help you target the right destinations.
- [Shipping rules](rules.md) will take you deeper into conditions and actions.
- [FAQ](faq.md) will answer questions about uninstalling, limits, and safety.

## Video tutorial

[Add Getting Started Video Tutorial]

A short video that follows this exact guide is on the way. It will appear right here when it is ready.
