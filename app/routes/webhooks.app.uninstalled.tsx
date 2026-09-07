import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { removeCarrierService } from "../services/carrier-registration";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Best-effort carrier service teardown (§A3): the offline token may already
  // be dead at this point, so removal tolerates failure — the stored GID is
  // cleared regardless, and any orphaned service is repaired by ensure()'s
  // LIST self-heal if the merchant ever re-installs the app.
  const shopRow = await db.shop.findUnique({
    where: { shopDomain: shop },
    select: { id: true },
  });
  if (shopRow) {
    const { admin } = await authenticate.admin(request);
    await removeCarrierService(admin, shopRow.id).catch(function tolerated(error) {
      console.error(`Carrier teardown failed during uninstall for ${shop} (tolerated):`, error);
    });
  }

  return new Response();
};
