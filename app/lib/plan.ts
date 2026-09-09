/**
 * Plan classification (spec 003, architecture.md §A2) — pure module, zero
 * imports (enforced by the purity-guard test).
 *
 * Shopify exposes no Admin API field that reports whether carrier-calculated
 * shipping (CCS) is ENABLED on a shop; the plan display name is the
 * eligibility signal available. Classification steers UI only:
 *   - FUNCTIONS_ONLY shops are never offered the carrier lane and never
 *     probed (§A3; a probe would create a junk carrier service row).
 *   - CCS_ELIGIBLE shops get the real answer from the lazy create+delete
 *     probe (services/carrier-registration.ts) when they act.
 *   - Unknown display names default to CCS_ELIGIBLE so no shop is ever
 *     blocked from trying the carrier lane on a guess (plan 003 Task 1).
 */

export type PlanClass = "FUNCTIONS_ONLY" | "CCS_ELIGIBLE" | "ALL";

export interface PlanClassifyInput {
  displayName?: string | null;
  partnerDevelopment: boolean;
  shopifyPlus: boolean;
}

/** Friendly labels shared by the banner and the wizard (UX rule: no enums in UI). */
export const PLAN_CLASS_LABELS: Record<PlanClass, string> = {
  FUNCTIONS_ONLY: "Delivery rules",
  CCS_ELIGIBLE: "Delivery rules and carrier rates",
  ALL: "All features (development store)",
};

export function classifyShopPlan(input: PlanClassifyInput): PlanClass {
  // Dev stores can register carrier services regardless of plan tier.
  if (input.partnerDevelopment) {
    return "ALL";
  }
  if (input.shopifyPlus) {
    return "CCS_ELIGIBLE";
  }
  const name = (input.displayName ?? "").toLowerCase();
  if (name.includes("plus") || name.includes("advanced")) {
    return "CCS_ELIGIBLE";
  }
  const entryLevel = name.includes("basic") || name.includes("grow");
  if (entryLevel) {
    // Entry plans unlock carrier-calculated shipping only when billed
    // annually (Shopify plan rules, spec 003 §3).
    const annual = name.includes("annual") || name.includes("yearly");
    return annual ? "CCS_ELIGIBLE" : "FUNCTIONS_ONLY";
  }
  return "CCS_ELIGIBLE";
}

/**
 * Shop-row convenience wrapper: the stored columns carry displayName
 * (Shop.plan) and partnerDevelopment (Shop.isDevShop). shopifyPlus is
 * deliberately NOT persisted (§A5: no new columns) — a "Plus" display name
 * already classifies as CCS_ELIGIBLE through the string check above.
 */
export function planClassFromShop(shop: { plan: string | null; isDevShop: boolean }): PlanClass {
  return classifyShopPlan({
    displayName: shop.plan,
    partnerDevelopment: shop.isDevShop,
    shopifyPlus: false,
  });
}

export function planGuidanceBannerTone(planClass: PlanClass): "info" | "success" | "warning" {
  if (planClass === "FUNCTIONS_ONLY") {
    return "info";
  }
  if (planClass === "ALL") {
    return "success";
  }
  return "warning";
}

export interface PlanBannerStateInput {
  planClass: PlanClass;
  /** Value of prefs.planBannerDismissedFor when the page loaded (§A5). */
  dismissedFor: string | null;
  onboarded: boolean;
  carrierRegistered: boolean;
}

/**
 * Dismissal is keyed to the CURRENT plan class (spec 003 criterion 8): a
 * shop/update that changes the class makes the banner reappear on the next
 * load because the stored dismissal no longer matches.
 */
export function shouldShowPlanBanner(input: PlanBannerStateInput): boolean {
  if (!input.onboarded) {
    return false; // the setup wizard covers the screen before onboarding
  }
  if (input.planClass === "ALL") {
    return false; // development store: nothing to guide
  }
  if (input.dismissedFor === input.planClass) {
    return false;
  }
  if (input.planClass === "CCS_ELIGIBLE" && input.carrierRegistered) {
    return false; // already using the carrier lane
  }
  return true;
}
