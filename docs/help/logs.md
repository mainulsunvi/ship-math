# The request log

The request log is ShipMath's notebook. Every time checkout asks for rates, and every time you run the simulator, ShipMath will write down what came in, which rules were considered, and what came out. When something looks wrong at checkout, this page will show you exactly what ShipMath saw.

You will find the log under **Logs** in the app menu at the top of every page.

[Add Request Log Page Screenshot]

## What gets logged

Two kinds of runs will appear on the page, and each row carries a badge so you can tell them apart:

- **Live callback** (green badge): a real checkout asked for shipping rates, and your carrier rate rules answered. These rows only appear when your store is live with carrier rates turned on.
- **Simulation** (blue badge): you clicked **Run simulation** in the rate simulator. These rows are practice, and they will never touch a real order.

Each row shows the time, how many rates came back, and how long the run took in milliseconds.

## Reading a row

Click **Details** on any row and it will open up:

- **The input**: the destination, cart subtotal, weight, item count, and whether the customer was logged in.
- **Rules evaluated**: every rule the run considered, in priority order, with what happened to each one. A rule that did not match will say why, like "not matched (destination outside the zone (country list))".
- **Rates**: the delivery rates the run returned, with names and prices.
- **Input digest**: a short fingerprint of the input, handy when you want to check whether two checkouts asked for the same thing.

[Add Expanded Log Row Screenshot]

## Filtering and paging

The **Source** dropdown at the top will narrow the list: all runs, only live callbacks, or only simulations. The arrows at the bottom will move between pages, 50 rows at a time, newest first.

## How long rows are kept

Rows will stay for **30 days**, then ShipMath will tidy them away automatically. The log is a debugging tool, not an archive: when you are chasing a checkout mystery, look within the last month, and reproduce anything older with the simulator.

## What is not in the log

ShipMath will not log customer names, addresses beyond the destination codes, or payment details. The log holds just enough about each cart to explain a rate: totals, weights, destinations, and which rules fired.

## Video tutorial

[Add Request Log Video Tutorial]

A short tour of the log page, including reading a trace after a test checkout, is on the way. It will appear right here when it is ready.
