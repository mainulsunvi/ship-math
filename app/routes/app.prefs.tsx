import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getOrCreateShop, updatePrefs } from "../db.server";
import { planClassFromShop } from "../lib/plan";

/**
 * Dedicated prefs action route (spec 003, plan Task 3; wiring per Frontend
 * brief Task 0). ACTION-ONLY (no default export, same shape as the webhook
 * routes): Remix action bubbling is unreliable here because every leaf route
 * under /app has an action that 400s on unknown intents, so cross-cutting
 * preference intents post straight to /app/prefs instead.
 *
 * Intents:
 *   - dismiss-plan-banner : recomputes the plan class from the stored Shop
 *     row (server-side truth, so a stale client can never dismiss for the
 *     wrong class) and stores prefs.planBannerDismissedFor. The banner
 *     reappears when a shop/update changes the class, because the stored
 *     dismissal no longer matches (spec 003 criterion 8).
 */

interface PrefsActionReply {
  ok?: boolean;
  message?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  try {
    const shop = await getOrCreateShop(session.shop);
    const formData = await request.formData();
    const intent = String(formData.get("intent") || "");
    if (intent === "dismiss-plan-banner") {
      await updatePrefs(shop.id, { planBannerDismissedFor: planClassFromShop(shop) });
      return json<PrefsActionReply>({ ok: true });
    }
    return json<PrefsActionReply>(
      { ok: false, message: `Unknown intent: ${intent}` },
      { status: 400 },
    );
  } catch (error) {
    return json<PrefsActionReply>(
      { ok: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
