# Getting started with ShipMath

This guide follows your first ten minutes with ShipMath. A setup wizard will open by itself the first time you arrive, and by the end you will have zones and rules built, previewed, and one switch away from your checkout.

## What will ShipMath do for you?

ShipMath changes how delivery options appear and are priced at your checkout. After you set it up, you will be able to:

- hide delivery options you do not want to offer.
- rename options so customers understand them better.
- move options up or down the list.
- replace a price with your own rate, like a flat fee or free shipping.

You will work with two things. A **zone** is a saved group of places, like "United Kingdom" or "everywhere". A **rule** is an instruction: when an order matches your conditions, ShipMath will change the delivery options.

## The wizard will open by itself

In your Shopify admin, click **Apps**, then click **ShipMath**. You will land on the Dashboard, and the setup wizard will open on top of it. It covers your Shopify plan, delivery zones, rate rules, carrier rates on plans that support them, and test mode.

The wizard is relaxed about being left alone:

- Every step is optional. Click **Continue** straight through if you like.
- Anything you create inside the wizard is a draft. Drafts are switched off, wear a "Draft" badge, and change no checkout.
- Nothing turns on until you press **Finish setup** on the last step.
- Click **Skip for now** at the bottom of the wizard and it will hide itself. It will open again the next time you open the Dashboard, and your drafts will wait, still off.

A row of numbered circles at the top of the wizard shows your progress. Finished steps fill with a checkmark, the step you are on gets a highlight, and **Back** will return you one step at any point.

[Add Setup Wizard Welcome Screenshot]

## Step 1: Welcome

The wizard greets you by store name and lists what the walkthrough covers. There is nothing to do here, so read it and click **Continue**.

## Step 2: Your Plan

ShipMath will read your store's Shopify plan and explain what it unlocks. You will see one of two cards:

- **Delivery rules**: your plan supports hiding, renaming, and reordering the shipping options your store already shows. Carrier-calculated rates are not included; they need a higher plan or annual billing.
- **Delivery rules and carrier rates**: your plan can also use carrier-calculated shipping, where ShipMath calculates live rates on its own server and shows them at checkout.

Either way, delivery rules work on every plan, so the walkthrough applies to you no matter which card appears. Development stores see everything unlocked. If you switch Shopify plans later, ShipMath will update its guidance automatically.

[Add Your Plan Step Screenshot]

## Step 3: Delivery Zones (optional)

Zones group destinations by country, province, and postal code, so a rule can target exactly where it applies.

Click **Add a zone** and the zone form will open right inside the step, below the zone list. Give the zone a clear name like `UK only`, pick at least one country or choose worldwide, and add provinces or postal codes if you want to narrow it down. Press **Save draft**.

The form has no on/off switch here, and the app will tell you why: "Draft zones turn on when you finish setup." Your zone will appear in the step's list with its "Draft" badge beside the name. You can add another zone straight after; each one waits as a draft until you finish.

You can also skip this step and sort out zones later on the Zones page. The full guide is [Zones](zones.md).

[Add Wizard Zones Step Screenshot]

## Step 4: Rate Rules (optional)

Here is the main event. A card titled "Set Up With AI" will explain that AI setup is coming soon: eventually you will describe your shipping needs in plain words and ShipMath will draft the rules for you. The button is switched off for now, so the manual route sits right below it.

Click **Create a rule draft** and the rule form will open:

1. Type a name you will recognize later, like `Hide local pickup`.
2. Set the priority. Lower numbers run first, so priority 10 will run before priority 20. Leave the suggested number if you are unsure.
3. Choose a zone from the previous step, or leave the zone empty and the rule will apply everywhere.
4. Add conditions in the **Conditions** card if the rule should apply only to some orders, for example cart total greater than 100. A rule with no conditions will apply to every order.
5. Add the action in the **Then** card. The first action decides what the rule does: hide, rename, move, or set your own carrier rate.
6. Press **Save draft**.

Your rule will join the drafts list on the step. Like zones, draft rules turn on when you finish setup, and skipping this step is fine too: you can create rules later on the Rules page. The full guide is [Shipping rules](rules.md).

[Add Wizard Rate Rules Step Screenshot]

## Step 5: Carrier Rates (some plans only)

This step appears only when your Shopify plan supports carrier-calculated shipping. If you never see it, your plan runs checkout through delivery rules, and the wizard will move you straight to test mode.

Carrier rates let ShipMath calculate shipping costs on its own server and send them to checkout. When a customer checks out, Shopify will ask ShipMath for a price through a secure callback, and your rules decide it.

A switch labeled **Register carrier rates** will start off. Leave it off to finish with delivery rules only; you can register carrier rates any time from Settings. Switch it on if you want live rates set up as part of finishing.

[Add Carrier Rates Step Screenshot]

## Step 6: Test Mode

A fresh install starts with test mode on, so your live checkout stays safe: nothing you set up in the wizard changes what customers see until you go live.

There is nothing to click on this step. It simply sets expectations: you will preview your rules on the Simulator page, then turn test mode off and press **Go live** in Settings when you are ready. Finishing setup does not skip that step for you.

[Add Wizard Test Mode Step Screenshot]

## Step 7: Finish Setup

The last step lists exactly what will happen when you press the button:

- Your draft rules and zones will turn on.
- ShipMath will sync your configuration to the checkout.
- If you switched on **Register carrier rates**, ShipMath will register carrier rates with Shopify too.

Press **Finish setup**. The wizard will close, and a green banner titled "Setup Complete" will take its place, confirming how many rules and zones turned on. The banner carries an **Open simulator** button and links to Settings for when you are ready to go live.

Two things worth knowing at that moment:

- Test mode is still on. Your rules are on and synced, but customers will see nothing new until you turn test mode off in Settings. Preview first on the [Simulator](simulator.md) page; that order is the safest one.
- If the checkout sync fails, the wizard will show a "Setup Saved, Sync Failed" message instead, and the Dashboard will offer a **Retry sync** button. Your setup is saved either way, so nothing is lost.

[Add Finish Setup Step Screenshot]

[Add Setup Complete Banner Screenshot]

## After the wizard: your Dashboard

With setup finished, the Dashboard becomes home base. The **Checkout Function Status** card at the top shows sync health: when checkout last received your rules, how many rules run, and how much of the checkout budget they use. The **Environment** card shows the test mode state and the evaluation mode setting. The rules table lists every rule with its switch, priority arrows, and edit, duplicate, and delete actions. You will find the same table on the **Rules** page in the app menu.

Two shortcuts deserve a mention. **Add sample rules** on the status card loads a small starter set you can open, change, or delete, which is handy for seeing finished examples. And **New rule** at the top of the page opens the same rule form you used in the wizard, except a rule saved there turns on and syncs right away instead of waiting as a draft.

[Add ShipMath Dashboard Screenshot]

## A banner about your plan

Sometime after setup, a banner about your Shopify plan may appear at the top of the app. On entry plans it will reassure you that delivery rules work on your plan. On plans that support carrier-calculated shipping it will point you toward Settings and the **Go live** button.

Click **Dismiss** and it will stay away while your plan stays the same. If your Shopify plan changes later, the banner will return once with updated guidance. The [FAQ](faq.md) has the full story.

## Run the wizard again any time

Open **Settings** and find the **Setup** card, then press **Restart setup**. You will land back on the Dashboard with the wizard open, exactly as on your first day.

Your running rules keep working the entire time. Only rules that are still switched off (drafts) will turn on when you finish the wizard again, so restarting can never switch a running rule off.

[Add Restart Setup Card Screenshot]

## What to read next

- [Zones](zones.md) will help you target the right destinations.
- [Shipping rules](rules.md) will take you deeper into conditions and actions.
- [Test mode and evaluation mode](test-mode.md) will walk you through the switch that takes your rules live.
- [FAQ](faq.md) will answer questions about uninstalling, limits, and safety.

## Video tutorial

[Add Getting Started Video Tutorial]

A video that follows this exact guide, from the welcome step to the "Setup Complete" banner, is on the way. It will appear right here when it is ready.
