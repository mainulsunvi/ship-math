import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Banner, Link, Page, Text } from "@shopify/polaris";
import { planGuidanceBannerTone, type PlanClass } from "../../lib/plan";

/**
 * Plan guidance banner (spec 003, plan Task 3) — rendered by the app layout
 * between the nav and the page content while the plan state warrants it and
 * the merchant has not dismissed it for the current plan class. ALL (dev
 * store) never shows: there is nothing to guide.
 *
 * Dismissal posts { intent: "dismiss-plan-banner" } to /app/prefs (the
 * dedicated prefs action route); the class stored server-side is recomputed
 * from the Shop row, so the banner reappears after a plan change even if the
 * client was stale. The local `dismissed` state hides it immediately while
 * the loader revalidation catches up.
 */

/** The two classes that ever render guidance (ALL is filtered upstream). */
type BannerPlanClass = Extract<PlanClass, "FUNCTIONS_ONLY" | "CCS_ELIGIBLE">;

interface PlanBannerProps {
  planClass: BannerPlanClass;
  /** True when the carrier service is registered (003 review: downgrade guidance). */
  carrierRegistered: boolean;
}

function PlanBanner({ planClass, carrierRegistered }: PlanBannerProps) {
  const fetcher = useFetcher();
  const [dismissed, setDismissed] = useState(false);

  function dismiss() {
    setDismissed(true);
    fetcher.submit({ intent: "dismiss-plan-banner" }, { method: "post", action: "/app/prefs" });
  }

  if (dismissed) {
    return null;
  }

  const busy = fetcher.state !== "idle";

  return (
    <Page>
      <Banner
        tone={planGuidanceBannerTone(planClass)}
        title={
          planClass === "FUNCTIONS_ONLY"
            ? "Delivery Rules Work on Your Plan"
            : "Carrier Rates Are Available on Your Plan"
        }
        action={{ content: "Dismiss", onAction: dismiss, loading: busy, disabled: busy }}
      >
        {planClass === "FUNCTIONS_ONLY" ? (
          carrierRegistered ? (
            <Text as="p" variant="bodyMd">
              Your Shopify plan changed and no longer includes carrier-calculated shipping, so the
              carrier rates ShipMath registered may stop appearing at checkout. Your delivery rules
              keep working. Open <Link url="/app/settings">Settings</Link> to review your setup or
              go fully live with delivery rules.
            </Text>
          ) : (
            <Text as="p" variant="bodyMd">
              Your Shopify plan supports delivery customization rules, so you can hide, rename,
              and reorder the shipping options your store already shows. Carrier-calculated rates
              need a higher Shopify plan or annual billing. Every other ShipMath feature works
              the same either way.
            </Text>
          )
        ) : (
          <Text as="p" variant="bodyMd">
            Your Shopify plan meets Shopify&apos;s{" "}
            <Link url="https://help.shopify.com/en/manual/shipping/shipping-settings/carrier-accounts" external>
              carrier-calculated shipping
            </Link>{" "}
            requirement, so ShipMath can serve live rates at checkout. Open{" "}
            <Link url="/app/settings">Settings</Link> and press Go live to register carrier rates.
            Delivery rules keep working while you decide.
          </Text>
        )}
      </Banner>
    </Page>
  );
}

export default PlanBanner;
