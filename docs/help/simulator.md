# The rate simulator

The simulator is ShipMath's rehearsal stage. It will run your rules against a pretend order, with a pretend destination and a pretend customer, and it will show you exactly what checkout would do. No real order will be placed, and no customer will see anything. You will find it under **Simulator** in the app menu at the top of every page.

[Add Simulator Page Screenshot]

## Why use the simulator

Building a rule is easy. Being sure the rule does what you meant is the hard part. The simulator will let you:

- see the shipping rates a real cart would receive, before any real cart exists;
- watch every rule run, one by one, with a plain-English reason for why it matched or did not;
- test a risky change, like hiding options in one country, without touching the checkout;
- compare runs before and after an edit, because every run is saved on the [Request log](logs.md) page.

The simulator runs the exact same engine the checkout uses. What you see on this page is what customers would get.

## The page at a glance

The page has two columns:

- On the left you will build the pretend order: cart lines, destination, location, customer, and which rules to run.
- On the right you will see the result: an order summary that looks like checkout, the shipping rates your rules produce, and the rule trace.

When everything looks right, click **Run simulation** at the top of the page.

[Add Simulator Left Column Screenshot]

## Step 1: Build the cart

In the **Products** card you will find two ways to add cart lines:

- **Pick products** opens Shopify's product picker. Choose products from your catalog and ShipMath will fill in the real titles, prices, weights, and SKUs. If a product has several variants, ShipMath will add the first variant; you can edit any detail afterwards.
- **Add custom line** creates a blank line you can fill in yourself. This is handy for testing prices or weights you do not want to create a product for.

Every line shows an editable row: title, price, weight in grams, and quantity, plus SKU, vendor, and product tags. The last three matter when a rule has conditions that look at them, like "vendor equals Acme" or "customer is tagged wholesale and the product is tagged fragile". Click the **X** on a row to remove it.

The simulator needs at least one line with a title and a valid price before it will run.

[Add Simulator Products Card Screenshot]

## Step 2: Choose where it ships

The **Destination** card is a full address form, like the one a customer fills in at checkout: name, street address, city, country, province or state, postal code, and phone. Pick a country from the list and the form will adjust: the United States and Canada will show a province dropdown, other countries will accept a free-text region.

Two of these fields drive most rules: **country** (zones match on it) and **postal code** (postal code conditions match on it). If you are testing a rule that targets a postal code range, type a code inside the range.

## Step 3: Choose location and customer

The **Location and customer** card covers the rest of what a rule can see:

- **Pickup location** selects one of your store's locations, so rules with pickup conditions will behave as they would for a local delivery or pickup order.
- **Customer** offers three ready-made testers: a guest who is not logged in, a "VIP Tester" tagged VIP, and a "Wholesale Tester" tagged wholesale. Your real customers will also appear in the list, and picking one will bring their tags along automatically.
- **Customer tags** shows the tags for the chosen customer. You can edit them by hand to test a tag you have not assigned to anyone yet.
- **Shopify shipping zone (destination shortcut)** lists the shipping zones you already set up in Shopify. Choosing one will fill the destination country for you, which is the quickest way to test a rule aimed at a whole region.

[Add Simulator Destination Card Screenshot]

## Step 4: Choose which rules run

By default the simulator will run every rule, exactly as checkout would. The **Rules** card lets you narrow the run:

- Click **All** or **None** to select the list in one click.
- Tick individual rules to run just those. This is the fastest way to debug one rule in isolation.
- Rules that are switched off on the Dashboard will appear unticked and cannot be selected, because checkout will not run them either.

## The order summary

The right column starts with an **Order summary** that mirrors checkout:

- the ship-to address, written the way checkout shows it;
- every cart line with its image, price, and line total;
- the item count, total weight, and subtotal;
- a **Shipping rates** box with checkout's full option list for that cart: the shipping methods you defined in Shopify (like Standard and Express) with a "store" label, plus the rates your ShipMath carrier rate rules produce with a "rule" label. Pick one and the Shipping and Total rows will update.

The store's own methods behave like checkout too: the destination has to fall inside one of your Shopify shipping zones (including Markets-based shipping), the cart has to satisfy each method's minimum or maximum order amount and weight window, and your hide, rename, and move rules will remove, retitle, or reorder them exactly as they would at checkout. A method that disappeared from the box is a real result: the delivery customizations list below the box will name the rule that hid it.

One checkout behavior surprises many store owners: a zone that covers the rest of the world matches every address, so its methods (like International Shipping) will appear next to your domestic ones even when the destination is domestic. That is not a mistake. Checkout shows the rates of every zone that matches the address, and ShipMath's preview shows the same combined list. If you do not want international rates on domestic orders, tighten the rest-of-world zone in Shopify, or add conditions to those rates.

If ShipMath cannot read the store's shipping setup at all, a warning banner at the top of the page will say why, and the rates box will show only rule-based rates. The most common reason is a missing permission: reinstall the app or rerun shopify app dev so the shipping permissions are granted, then reload the page.

### Delivery customizations, spelled out

Right under the rates, the **Delivery customizations** list will show every change your rules made to the options, one line per change: which option was hidden, renamed (with the old and new name), or moved (with its new position), and which rule did it. If your customization rules ran but the list says they matched no shipping option, the rules' option filters (like "title contains") do not fit any option here — the rule trace will show the same story from the rules' side.

If no options appear at all, checkout would show none for that cart and destination: either nothing applies, or a hide rule removed every option.

[Add Simulator Order Summary Screenshot]

## The rule trace

Below the summary, the **Rule trace** card lists every rule that ran, with a badge:

- a green badge means the rule matched. For carrier rate rules it will also show the rate produced;
- a gray badge means it did not, and ShipMath will tell you why, down to the exact condition or zone that stopped it.

Reading the trace is the fastest way to spot a condition that says the opposite of what you meant. If a rule you expected to match shows gray, the reason next to it will usually name the culprit.

[Add Simulator Rule Trace Screenshot]

## What the simulator does not do

The simulator will never place an order, change a customer, or touch your checkout. Runs are practice only. Each run will be saved on the [Request log](logs.md) page with a blue **Simulation** badge, and log rows will be removed after 30 days like any other.

## Video tutorial

[Add Simulator Video Tutorial]

A video walkthrough of the simulator, from an empty cart to a full rule trace, is on the way. It will appear right here when it is ready.
