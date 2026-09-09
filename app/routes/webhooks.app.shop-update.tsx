import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { saveShopPlanDetails } from "../db.server";

/**
 * shop/update webhook (spec 003 §5, plan 003 Task 2): mirrors the shop's
 * display name + plan display name onto the Shop row so plan classification
 * (app/lib/plan.ts) can run without an admin API call.
 *
 * Retry safety: the handler is a plain field upsert (saveShopPlanDetails) —
 * Shopify redeliveries write the same values again and cannot duplicate or
 * corrupt anything.
 */

interface ShopUpdatePayload {
  name?: unknown;
  plan_display_name?: unknown;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const body = payload as ShopUpdatePayload;
  // An empty plan_display_name (shops without a paid plan) is stored as null
  // so "missing" and "unknown" share one representation (plan.ts defaults).
  await saveShopPlanDetails(shop, {
    name: asStringOrNull(body.name),
    plan: asStringOrNull(body.plan_display_name),
  });

  return new Response();
};
