# Frequently asked questions

Quick answers to the questions store owners ask most. If your question is not here, open the **Contact** page in the app and send a message. Every message is read.

## Everyday questions

**I saved a rule but nothing changed at checkout. What should I check?**

Three things, in this order:

1. **Test mode**: if it is on, your rules will intentionally do nothing at checkout. See [Test mode and evaluation mode](test-mode.md).
2. **Sync status**: look at *Last synced* on the Dashboard. If a sync failed, a red banner will offer a **Retry sync** action. See [Syncing your changes](sync.md).
3. **The rule itself**: is the rule's switch on? Are its conditions too narrow? Does its zone match the address you are testing with? See [Shipping rules](rules.md).

**Can one rule apply to every destination?**

Yes. Leave the zone empty when you create the rule, and it will apply everywhere.

**Do I need a zone at all?**

No. Zones are a convenience for reusing the same group of destinations in many rules. See [Zones](zones.md).

**Can I copy a rule?**

Yes. Use the duplicate action in the rules table. The copy will appear right next to the original, ready for you to edit.

**What is the short ID on the edit page for?**

Every rule gets a short unique ID. It is part of the edit page address, so you can bookmark rules you edit often, and you can quote it when asking for help so there is no doubt about which rule you mean.

## Uninstalling and reinstalling

**What happens if I uninstall ShipMath and install it again later?**

When you uninstall, ShipMath's access to your store will end and the app sign-in will be removed. Your saved zones and rules will be kept. They are yours.

When you reinstall on the same store:

1. Sign in again, and you will find your zones and rules exactly as you left them.
2. Open the Dashboard and press **Sync now**. This will make sure the checkout matches your saved rules before you start changing things again.

[Add Dashboard After Reinstall Screenshot]

## Limits and large stores

**What happens if I hit the limits?**

ShipMath keeps **everything you save**. The limits only affect what fits into the copy of your rules that the checkout uses:

- Your rules table will always show all your rules, on pages of 50.
- The checkout configuration has a size budget. If a rule does not fit, it will be **excluded from the checkout** and flagged in the sync warnings. It will not be deleted. Trim older rules, sync again, and it will come back.

So if a plan change ever lowers your limits, nothing will be lost. The app keeps all your data, and the checkout will simply carry what fits, with a clear warning about the rest. See [Syncing your changes](sync.md).

**I have a very large catalog. Does anything slow down?**

Your product catalog size will not slow rule matching at checkout. The checkout reads a small, prebuilt configuration, not your catalog.

Two things will change with size:

- The rules table paginates at 50 rules per page, so browsing will stay fast.
- A bigger configuration uses more of the checkout budget, which will make sync warnings more likely. Keep only the rules you need, and the budget will stay healthy.

[Add Rules Pagination Screenshot]

## Reliability

**What happens if Shopify sends the same update more than once?**

Sometimes Shopify sends the same update again to make sure it arrived. That is safe. ShipMath is built so that the same update can never be applied twice. You will never get duplicate zones, duplicate rules, or doubled changes.

**Will my checkout break if ShipMath is briefly unavailable?**

No. The checkout reads the last synced configuration, not the app. Your rules will keep working at checkout even while the app itself is unreachable. You just cannot make changes until it is back.

## Video tutorial

[Add FAQ Video Tutorial]

A rapid-fire FAQ video, with screen demos of the answers above, is on the way. It will appear right here when it is ready.
