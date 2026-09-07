/**
 * Carrier callback verification (spec 007, architecture §A3) — server module.
 *
 * Shopify signs the callback body with the SAME app secret used for webhooks:
 * base64 HMAC-SHA256 over the RAW body, sent as `X-Shopify-Hmac-Sha256`.
 * Comparison is timing-safe. An empty/misconfigured secret fails CLOSED —
 * unsigned callbacks must never reach the rate engine.
 *
 * The domain gate is separate (the route does the lookup): the payload's
 * `rate.origin_shop_domain` must match an installed Shop row. Either gate
 * failing → the route answers `200 {rates: []}` (never 4xx — retry storms).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { API_SECRET } from "../../shopify.server";

export const CARRIER_HMAC_HEADER = "X-Shopify-Hmac-Sha256";

export function verifyCarrierCallback(rawBody: string, hmacHeader: string | null): boolean {
  if (!hmacHeader || API_SECRET === "") {
    return false; // missing signature or misconfigured app → fail closed
  }
  const expected = createHmac("sha256", API_SECRET).update(rawBody).digest("base64");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
