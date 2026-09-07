# Zones: group your destinations

A zone is a saved group of places. Instead of picking the same countries again and again inside every rule, you save the group once, give it a name, and reuse it anywhere.

For example, save a zone called `Europe` with your European countries. Every rule that targets Europe can use that one zone. Change the countries in the zone later, and every rule that uses it follows along.

You manage zones on the **Zones** page in the app menu.

[Add Zones Page Screenshot]

## What can a zone contain?

A zone is built from three building blocks. You can use one, two, or all three:

1. **Countries**: one country, several countries, or the whole world.
2. **Provinces and states**: available when the zone covers exactly one country. For example, only California and Nevada inside a `US West` zone.
3. **Postal codes**: narrow a zone down to specific postal codes or postal districts. See [Postal codes explained](#postal-codes-explained) below.

## Create a zone

1. Click **Zones** in the app menu.
2. Start a new zone. A form opens.
3. Type a name you will recognize later, like `UK mainland` or `Holiday islands`.
4. Pick at least one country. If the zone should match every destination, choose the worldwide option instead.
5. If you picked exactly one country, two extra options appear:
   - A list of provinces or states, if you want to narrow the zone inside that country.
   - Postal code rules, described below.
6. Check the enable switch. A switched-on zone is active. A switched-off zone is skipped.
7. Save the zone.

The zones table shows a **usage count** for each zone, so you can see at a glance how many rules depend on it.

[Add New Zone Form Screenshot]

## Edit or delete a zone

Open any zone from the Zones page and change what you need.

Deleting a zone does not delete your rules. Rules that used the zone simply lose it and apply to every destination again. If that is not what you want, edit the rules first, or switch the zone off instead of deleting it.

[Add Delete Zone Confirmation Screenshot]

## Switch a zone on or off

Every zone row has a switch:

- Switch **off**: the zone stops matching. Every rule that uses it stops applying too. The zone is also left out of new syncs to the checkout.
- Switch **on**: the zone works again, and its rules come back with it.

This is perfect for seasonal setups. Build a `Holiday shipping` zone in November, switch it off in January, and switch it back on next year. Nothing to rebuild.

[Add Zone Enable Switch Screenshot]

## Postal codes explained

Postal code rules narrow a zone below country level. Two modes are available:

- **FULL**: match complete postal codes. Type one per line, like `SW1A 1AA`.
- **PARTIAL**: match the beginning of a postal code. For example, `SW1` matches every code that starts with SW1.

PARTIAL mode has two limits, and they exist for a good reason:

1. It works only when the zone covers a single country.
2. It works only for the United Kingdom and Canada, because postal systems differ from country to country and these two work well with partial matching.

If you type a postal code the zone cannot support, ShipMath tells you right away and explains what to fix. You are never left guessing.

[Add Postal Code Rules Screenshot]

## Good to know

- Provinces only apply to single-country zones. For multi-country or worldwide zones, the province list is ignored.
- A rule without a zone applies everywhere.
- Changes to zones sync to your checkout automatically. If a sync fails, a banner offers a retry. See [Syncing your changes](sync.md).

## Video tutorial

[Add Zones Video Tutorial]

A zone walkthrough, including postal codes, is on the way. It will appear right here when it is ready.
