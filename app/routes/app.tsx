import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import brandStyles from "../styles/brand.css?url";
import ShipMathNav from "../components/global/ShipMathNav";
import ShipMathFooter from "../components/global/ShipMathFooter";
import PlanBanner from "../components/global/PlanBanner";

import { authenticate } from "../shopify.server";
import { getOrCreateShop, readPrefs } from "../db.server";
import { ensureShopPlanDetails } from "../services/shop-details";
import { shouldShowPlanBanner } from "../lib/plan";

export const links = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: brandStyles },
];

/**
 * Layout loader (plan 003 Task 3): loads the shop once, backfills plan
 * details on first run (one Admin GraphQL call, cached on the Shop row), and
 * derives the plan banner state from prefs. Resilient by contract: the plan
 * banner is guidance, never a gate — any failure below degrades to planClass
 * null + banner hidden instead of 500-ing the whole embedded app
 * (ensureShopPlanDetails itself never throws).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = await getOrCreateShop(session.shop);
    const details = await ensureShopPlanDetails(admin, session.shop);
    const prefs = readPrefs(shop);
    const planClass = details.planClass;
    const showPlanBanner =
      planClass !== null &&
      shouldShowPlanBanner({
        planClass,
        dismissedFor: prefs.planBannerDismissedFor ?? null,
        onboarded: shop.onboardedAt !== null,
        carrierRegistered: shop.carrierServiceId !== null,
      });
    return json({ apiKey, planClass, showPlanBanner, carrierRegistered: shop.carrierServiceId !== null });
  } catch (error) {
    console.error("App layout loader degraded; plan banner hidden:", error);
    return json({ apiKey, planClass: null, showPlanBanner: false, carrierRegistered: false });
  }
}

export default function App() {
  // planClass + showPlanBanner drive the plan guidance banner; the tone and
  // copy live in the component (planGuidanceBannerTone). ALL never shows and
  // a null planClass (degraded loader) never shows either.
  const { apiKey, planClass, showPlanBanner, carrierRegistered } = useLoaderData<typeof loader>();
  const bannerPlanClass =
    planClass === "FUNCTIONS_ONLY" || planClass === "CCS_ELIGIBLE" ? planClass : null;

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">
          Dashboard
        </Link>
        <Link to="/app/zones">Zones</Link>
        <Link to="/app/rules">Rules</Link>
        <Link to="/app/simulator">Simulator</Link>
        <Link to="/app/settings">Settings</Link>
        <Link to="/app/contact">Contact Us</Link>
      </NavMenu>
      <ShipMathNav />
      {showPlanBanner && bannerPlanClass !== null ? (
        <PlanBanner planClass={bannerPlanClass} carrierRegistered={carrierRegistered} />
      ) : null}
      <Outlet />
      <ShipMathFooter />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
