# Zones: group your destinations

A zone is a saved group of places. Instead of picking the same countries again and again inside every rule, you will save the group once, give it a name, and reuse it anywhere.

For example, you could save a zone called `Europe` with your European countries. Every rule that targets Europe will use that one zone. If you change the countries in the zone later, every rule that uses it will update automatically.

You will manage zones on the **Zones** page in the app menu.

[Add Zones Page Screenshot]

## What can a zone contain?

A zone is built from three building blocks, and you can use one, two, or all three:

1. **Countries**: one country, several countries, or the whole world.
2. **Provinces and states**: this option will appear only when the zone covers exactly one country. You could, for example, pick only California and Nevada inside a `US West` zone.
3. **Postal codes**: these will narrow a zone down to specific postal codes or postal districts. See [Postal codes explained](#postal-codes-explained) below.

## Create a zone

1. Click **Zones** in the app menu.
2. Start a new zone. A form will open.
3. Type a name you will recognize later, like `UK mainland` or `Holiday islands`.
4. Pick at least one country. If the zone should match every destination, choose the worldwide option instead.
5. If you picked exactly one country, two extra options will appear. There will be a list of provinces or states if you want to narrow the zone inside that country, and there will be postal code rules, described below.
6. Check the enable switch. A switched-on zone will be active, and a switched-off zone will be skipped.
7. Save the zone.

The zones table will show a **usage count** for each zone, so you will see at a glance how many rules depend on it.

[Add New Zone Form Screenshot]

## Edit or delete a zone

Open any zone from the Zones page and change whatever you need. The form will fill in with the current settings, and your changes will take effect when you save.

Deleting a zone will not delete your rules. The rules will keep working, but from then on they will apply to every destination. If that is not what you want, edit the rules first, or switch the zone off instead of deleting it.

[Add Delete Zone Confirmation Screenshot]

## Switch a zone on or off

Every zone row has a switch, and it will work like this:

- Switch it **off**, and the zone will stop matching. Every rule that uses it will stop applying too, and the zone will be left out of new syncs to the checkout.
- Switch it back **on**, and the zone will work again, and its rules will come back with it.

This is perfect for seasonal setups. You could build a `Holiday shipping` zone in November, switch it off in January, and switch it back on next year. Nothing to rebuild.

[Add Zone Enable Switch Screenshot]

## Postal codes explained

Postal code rules will narrow a zone below country level. Two modes are available:

- **FULL** will match complete postal codes. Type one per line, like `SW1A 1AA`.
- **PARTIAL** will match the beginning of a postal code. For example, `SW1` will match every code that starts with SW1.

PARTIAL mode has two limits:

1. It will work only when the zone covers a single country.
2. It will work only for the United Kingdom and Canada, because postal systems differ from country to country and these two work well with partial matching.

If you type a postal code the zone cannot support, ShipMath will tell you right away and explain what to fix. You will never be left guessing.

[Add Postal Code Rules Screenshot]

## Good to know

- Provinces only apply to single-country zones. For multi-country or worldwide zones, the province list will be ignored.
- A rule without a zone will apply everywhere.
- Changes to zones will sync to your checkout automatically. If a sync fails, a banner will offer a retry. See [Syncing your changes](sync.md).

## Video tutorial

[Add Zones Video Tutorial]

A zone walkthrough, including postal codes, is on the way. It will appear right here when it is ready.
