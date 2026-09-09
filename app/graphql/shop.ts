/**
 * Shop queries (spec 003 §3). Plan detection is ONE cached call: the
 * display name + dev/plus flags are persisted on the Shop row and refreshed
 * by the shop/update webhook (webhooks.app.shop-update.tsx), so the admin
 * query runs at most once per shop (plus after plan changes).
 */

interface ShopDetailsResult {
  data?: {
    shop?: {
      name?: string | null;
      plan?: {
        displayName?: string | null;
        partnerDevelopment?: boolean | null;
        shopifyPlus?: boolean | null;
      } | null;
    } | null;
  };
  errors?: unknown;
}

export const SHOP_DETAILS = `#graphql
  query ShopDetails {
    shop {
      name
      plan {
        displayName
        partnerDevelopment
        shopifyPlus
      }
    }
  }
` as const;

export type { ShopDetailsResult };
