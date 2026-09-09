/**
 * First-run shop plan details population (spec 003 §3, plan 003 Task 2).
 *
 * The `shop/update` webhook only fires when something about the shop CHANGES
 * (and on some app events), so a freshly installed shop would otherwise keep
 * an empty `plan`/`name` forever. ensureShopPlanDetails() backfills those
 * fields from a single admin GraphQL call the first time a loader needs the
 * plan class — then never again (idempotent: it only writes when the stored
 * row is missing `plan` or `name`).
 *
 * Loader-safety contract: this function NEVER throws. GraphQL/transport/DB
 * failures degrade to `{ fetched: false, error }` with the best-effort plan
 * class classified from the stored row (unknown display names classify as
 * CCS_ELIGIBLE per plan.ts, so a transient failure never blocks the
 * carrier lane on a guess).
 */

import { authenticate } from "../shopify.server";
import { getOrCreateShop, saveShopPlanDetails } from "../db.server";
import { SHOP_DETAILS, type ShopDetailsResult } from "../graphql/shop";
import { classifyShopPlan, planClassFromShop, type PlanClass } from "../lib/plan";

/**
 * The package does not re-export its admin client type; derive it from
 * `authenticate.admin` so callers pass exactly what the Remix SDK returns
 * (same derivation pattern as app/services/function-owner.ts).
 */
type AdminApiClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

export type { AdminApiClient };

export interface EnsureShopPlanDetailsResult {
  /** Classified plan for UI guidance; null only when even the DB row is unreachable. */
  planClass: PlanClass | null;
  /** true when the admin GraphQL call succeeded this run. */
  fetched: boolean;
  /** Present when fetching failed — loaders surface/log it, never rethrow. */
  error?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function graphQlErrorMessage(errors: unknown): string {
  try {
    return JSON.stringify(errors);
  } catch {
    return "unserializable GraphQL errors";
  }
}

/**
 * Guarantee Shop.plan/name/isDevShop are populated, fetching from the Admin
 * API exactly once (first load after install, or whenever a field is still
 * missing — the webhook refreshes them on plan changes thereafter).
 */
export async function ensureShopPlanDetails(
  admin: AdminApiClient,
  shopDomain: string,
): Promise<EnsureShopPlanDetailsResult> {
  let shop;
  try {
    shop = await getOrCreateShop(shopDomain);
  } catch (error) {
    return { planClass: null, fetched: false, error: errorMessage(error) };
  }

  // Nothing to backfill — classify from storage, spend no API call.
  if (shop.plan !== null && shop.name !== null) {
    return { planClass: planClassFromShop(shop), fetched: false };
  }

  try {
    const response = await admin.graphql(SHOP_DETAILS);
    const json = (await response.json()) as ShopDetailsResult;
    const shopData = json.data?.shop;
    if (!shopData) {
      // GraphQL-level failure (errors array / empty payload): keep the
      // stored-row classification, report the failure, never throw.
      return {
        planClass: planClassFromShop(shop),
        fetched: false,
        error: graphQlErrorMessage(json.errors ?? "shop payload missing"),
      };
    }
    const displayName = shopData.plan?.displayName ?? null;
    const partnerDevelopment = shopData.plan?.partnerDevelopment ?? false;
    await saveShopPlanDetails(shopDomain, {
      name: shopData.name ?? null,
      plan: displayName,
      isDevShop: partnerDevelopment,
    });
    return {
      planClass: classifyShopPlan({
        displayName,
        partnerDevelopment,
        shopifyPlus: shopData.plan?.shopifyPlus ?? false,
      }),
      fetched: true,
    };
  } catch (error) {
    return {
      planClass: planClassFromShop(shop),
      fetched: false,
      error: errorMessage(error),
    };
  }
}
