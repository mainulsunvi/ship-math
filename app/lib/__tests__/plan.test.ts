/**
 * Plan classification matrix (spec 003 §3, plan Task 1) — the displayName
 * heuristics, the unknown-default, tone mapping, and the banner show/hide
 * decision incl. the reappear-on-plan-change rule (criterion 8).
 */

import { describe, expect, it } from "vitest";
import {
  PLAN_CLASS_LABELS,
  classifyShopPlan,
  planClassFromShop,
  planGuidanceBannerTone,
  shouldShowPlanBanner,
} from "../plan";

describe("003 — classifyShopPlan displayName matrix", function () {
  it("development stores are ALL regardless of plan name", function () {
    expect(classifyShopPlan({ displayName: "Basic", partnerDevelopment: true, shopifyPlus: false })).toBe("ALL");
    expect(classifyShopPlan({ displayName: null, partnerDevelopment: true, shopifyPlus: false })).toBe("ALL");
  });

  it("Plus and Advanced plans are CCS_ELIGIBLE", function () {
    expect(classifyShopPlan({ displayName: "Shopify Plus", partnerDevelopment: false, shopifyPlus: false })).toBe("CCS_ELIGIBLE");
    expect(classifyShopPlan({ displayName: "Advanced Shopify", partnerDevelopment: false, shopifyPlus: false })).toBe("CCS_ELIGIBLE");
  });

  it("shopifyPlus flag alone is CCS_ELIGIBLE even with an unusual display name", function () {
    expect(classifyShopPlan({ displayName: "Enterprise Thing", partnerDevelopment: false, shopifyPlus: true })).toBe("CCS_ELIGIBLE");
  });

  it("monthly Basic and Grow plans are FUNCTIONS_ONLY", function () {
    expect(classifyShopPlan({ displayName: "Basic", partnerDevelopment: false, shopifyPlus: false })).toBe("FUNCTIONS_ONLY");
    expect(classifyShopPlan({ displayName: "Shopify Grow", partnerDevelopment: false, shopifyPlus: false })).toBe("FUNCTIONS_ONLY");
  });

  it("annually billed Basic and Grow plans are CCS_ELIGIBLE", function () {
    expect(classifyShopPlan({ displayName: "Basic annual", partnerDevelopment: false, shopifyPlus: false })).toBe("CCS_ELIGIBLE");
    expect(classifyShopPlan({ displayName: "Grow yearly", partnerDevelopment: false, shopifyPlus: false })).toBe("CCS_ELIGIBLE");
  });

  it("unknown display names default to CCS_ELIGIBLE (the probe decides, never block)", function () {
    expect(classifyShopPlan({ displayName: "Shopify", partnerDevelopment: false, shopifyPlus: false })).toBe("CCS_ELIGIBLE");
    expect(classifyShopPlan({ displayName: "Starter", partnerDevelopment: false, shopifyPlus: false })).toBe("CCS_ELIGIBLE");
    expect(classifyShopPlan({ displayName: "Paused", partnerDevelopment: false, shopifyPlus: false })).toBe("CCS_ELIGIBLE");
    expect(classifyShopPlan({ displayName: null, partnerDevelopment: false, shopifyPlus: false })).toBe("CCS_ELIGIBLE");
    expect(classifyShopPlan({ displayName: "", partnerDevelopment: false, shopifyPlus: false })).toBe("CCS_ELIGIBLE");
  });

  it("classification is case insensitive", function () {
    expect(classifyShopPlan({ displayName: "basic", partnerDevelopment: false, shopifyPlus: false })).toBe("FUNCTIONS_ONLY");
    expect(classifyShopPlan({ displayName: "ADVANCED", partnerDevelopment: false, shopifyPlus: false })).toBe("CCS_ELIGIBLE");
  });

  it("planClassFromShop maps the stored Shop columns", function () {
    expect(planClassFromShop({ plan: "Basic", isDevShop: false })).toBe("FUNCTIONS_ONLY");
    expect(planClassFromShop({ plan: null, isDevShop: true })).toBe("ALL");
    expect(planClassFromShop({ plan: "Advanced Shopify", isDevShop: false })).toBe("CCS_ELIGIBLE");
  });

  it("every plan class has a friendly label (UX rule: no raw enums in UI)", function () {
    expect(PLAN_CLASS_LABELS.FUNCTIONS_ONLY).toBeTypeOf("string");
    expect(PLAN_CLASS_LABELS.CCS_ELIGIBLE).toBeTypeOf("string");
    expect(PLAN_CLASS_LABELS.ALL).toBeTypeOf("string");
  });
});

describe("003 — planGuidanceBannerTone", function () {
  it("FUNCTIONS_ONLY is informational reassurance", function () {
    expect(planGuidanceBannerTone("FUNCTIONS_ONLY")).toBe("info");
  });

  it("CCS_ELIGIBLE guidance is a warning-toned prompt", function () {
    expect(planGuidanceBannerTone("CCS_ELIGIBLE")).toBe("warning");
  });

  it("ALL (dev store) is success toned", function () {
    expect(planGuidanceBannerTone("ALL")).toBe("success");
  });
});

describe("003 — shouldShowPlanBanner (criterion 8: reappear on plan change)", function () {
  const base = {
    planClass: "FUNCTIONS_ONLY" as const,
    dismissedFor: null,
    onboarded: true,
    carrierRegistered: false,
  };

  it("shows for an onboarded FUNCTIONS_ONLY shop that has not dismissed", function () {
    expect(shouldShowPlanBanner(base)).toBe(true);
  });

  it("never shows before onboarding (the wizard covers the screen)", function () {
    expect(shouldShowPlanBanner({ ...base, onboarded: false })).toBe(false);
  });

  it("hides after dismissal for the same plan class", function () {
    expect(shouldShowPlanBanner({ ...base, dismissedFor: "FUNCTIONS_ONLY" })).toBe(false);
  });

  it("reappears when the plan class changes (shop/update scenario)", function () {
    // Merchant dismissed the Basic guidance, then upgraded to Advanced:
    // the stored dismissal no longer matches the current class.
    expect(
      shouldShowPlanBanner({
        planClass: "CCS_ELIGIBLE",
        dismissedFor: "FUNCTIONS_ONLY",
        onboarded: true,
        carrierRegistered: false,
      }),
    ).toBe(true);
  });

  it("stays hidden for CCS_ELIGIBLE shops that already registered the carrier", function () {
    expect(
      shouldShowPlanBanner({
        planClass: "CCS_ELIGIBLE",
        dismissedFor: null,
        onboarded: true,
        carrierRegistered: true,
      }),
    ).toBe(false);
  });

  it("never shows for development stores (ALL)", function () {
    expect(shouldShowPlanBanner({ ...base, planClass: "ALL" as const })).toBe(false);
  });

  it("a downgrade from CCS to Basic re-shows guidance (reappear on change)", function () {
    expect(
      shouldShowPlanBanner({
        planClass: "FUNCTIONS_ONLY",
        dismissedFor: "CCS_ELIGIBLE",
        onboarded: true,
        carrierRegistered: true,
      }),
    ).toBe(true);
  });
});
