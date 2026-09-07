/**
 * Carrier service registration lifecycle (spec 007, architecture.md §A3):
 * ShipMath keeps exactly ONE carrier service per shop (`name: "ShipMath"`),
 * created only at go-live (testMode off + merchant action), with its GID on
 * Shop.carrierServiceId. Registration is binary — no syncedAt counterpart.
 * State self-heals: the GID is re-verified against LIST on every ensure, so
 * manual deletion in the admin is detected and repaired.
 */

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/**
 * The package does not re-export its admin client type; derive it from
 * `authenticate.admin` so callers pass exactly what the Remix SDK returns
 * (same derivation pattern as app/services/function-owner.ts).
 */
type AdminApiClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

import {
  CREATE_CARRIER_SERVICE,
  DELETE_CARRIER_SERVICE,
  LIST_CARRIER_SERVICES,
} from "../graphql/carrier";

export const CARRIER_SERVICE_NAME = "ShipMath";

interface CarrierServiceNode {
  id: string;
  name: string;
  callbackUrl: string | null;
  active: boolean | null;
}

interface CreateResult {
  data?: {
    carrierServiceCreate?: {
      carrierService?: CarrierServiceNode;
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  };
  errors?: unknown;
}

interface DeleteResult {
  data?: {
    carrierServiceDelete?: {
      deletedId?: string | null;
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  };
  errors?: unknown;
}

interface ListResult {
  data?: {
    carrierServices?: {
      edges?: Array<{ node?: CarrierServiceNode | null }>;
    };
  };
  errors?: unknown;
}

/** The public callback endpoint for the carrier lane (§A3 callback contract). */
export function carrierCallbackUrl(): string {
  const appUrl = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return `${appUrl}/carrierrates`;
}

async function listCarrierServices(admin: AdminApiClient): Promise<CarrierServiceNode[]> {
  const response = await admin.graphql(LIST_CARRIER_SERVICES);
  const payload = (await response.json()) as ListResult;
  return (payload.data?.carrierServices?.edges ?? [])
    .map(function node(edge) {
      return edge.node;
    })
    .filter(function present(node): node is CarrierServiceNode {
      return node !== null && node !== undefined;
    });
}

/**
 * Look up one carrier service by GID (Settings loader). Throws on transport /
 * scope errors so callers can distinguish "not found" from "cannot check".
 */
export async function findCarrierService(
  admin: AdminApiClient,
  gid: string,
): Promise<CarrierServiceNode | null> {
  const services = await listCarrierServices(admin);
  return services.find(function matches(node) {
    return node.id === gid;
  }) ?? null;
}

export interface EnsureCarrierResult {
  /** The delivery carrier service GID. */
  id: string;
  /** true when this call created the service; false when an existing one was reused/self-healed. */
  created: boolean;
}

/**
 * Guarantee the carrier service exists and its GID is persisted:
 *   1. Stored GID still resolves in LIST → reuse it (self-heal check).
 *   2. Otherwise create + persist. Throws on userErrors (caller surfaces).
 */
export async function ensureCarrierService(
  admin: AdminApiClient,
  shopId: string,
): Promise<EnsureCarrierResult> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { carrierServiceId: true },
  });

  if (shop.carrierServiceId) {
    const services = await listCarrierServices(admin);
    const existing = services.find(function matches(node) {
      return node.id === shop.carrierServiceId;
    });
    if (existing) {
      return { id: existing.id, created: false };
    }
    // Stored GID no longer resolves (deleted in admin) → recreate below.
  }

  const response = await admin.graphql(CREATE_CARRIER_SERVICE, {
    variables: {
      input: {
        name: CARRIER_SERVICE_NAME,
        callbackUrl: carrierCallbackUrl(),
        active: true,
        supportsServiceDiscovery: false,
      },
    },
  });
  const payload = (await response.json()) as CreateResult;
  const created = payload.data?.carrierServiceCreate?.carrierService;
  const userErrors = payload.data?.carrierServiceCreate?.userErrors ?? [];
  if (!created || userErrors.length > 0 || payload.errors) {
    throw new Error(
      `carrierServiceCreate failed: ${JSON.stringify(userErrors.length > 0 ? userErrors : payload.errors)}`,
    );
  }
  await prisma.shop.update({
    where: { id: shopId },
    data: { carrierServiceId: created.id },
  });
  return { id: created.id, created: true };
}

/**
 * Delete the carrier service and clear the stored GID. Tolerant by design:
 * already-deleted services and dead offline tokens (uninstall path) never
 * throw — the GID is cleared either way, and ensure()'s LIST check repairs
 * any drift later (§A3: registration is binary + self-healing).
 */
export async function removeCarrierService(admin: AdminApiClient, shopId: string): Promise<void> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { carrierServiceId: true },
  });
  const gid = shop?.carrierServiceId;
  if (gid) {
    try {
      const response = await admin.graphql(DELETE_CARRIER_SERVICE, {
        variables: { id: gid },
      });
      const payload = (await response.json()) as DeleteResult;
      const userErrors = payload.data?.carrierServiceDelete?.userErrors ?? [];
      if (userErrors.length > 0) {
        // "not found" is the expected already-deleted case; log anything else.
        console.error(`carrierServiceDelete userErrors for shop ${shopId}:`, JSON.stringify(userErrors));
      }
    } catch (error) {
      // Dead token / network — tolerated per §A3 uninstall semantics.
      console.error(`carrierServiceDelete failed for shop ${shopId} (tolerated):`, error);
    }
  }
  await prisma.shop.update({
    where: { id: shopId },
    data: { carrierServiceId: null },
  });
}

export type CcsProbeResult = "ELIGIBLE" | "CCS_OFF" | "ERROR";

/**
 * CCS detection probe (spec 003 OQ-1 resolution, §A3): create + immediate
 * delete, classify the outcome. Never called for FUNCTIONS_ONLY shops —
 * the caller (wizard step / Settings card) gates that. Short-circuits to
 * ELIGIBLE when the shop already has a registered service.
 */
export async function probeCcs(admin: AdminApiClient, shopId: string): Promise<CcsProbeResult> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    select: { carrierServiceId: true },
  });
  if (shop.carrierServiceId) {
    return "ELIGIBLE"; // already registered → CCS is on, no probe needed
  }

  const response = await admin.graphql(CREATE_CARRIER_SERVICE, {
    variables: {
      input: {
        name: `${CARRIER_SERVICE_NAME} probe`,
        callbackUrl: carrierCallbackUrl(),
        active: false,
        supportsServiceDiscovery: false,
      },
    },
  });
  let createdId: string | null = null;
  let probeError: unknown = null;
  try {
    const payload = (await response.json()) as CreateResult;
    const created = payload.data?.carrierServiceCreate?.carrierService;
    const userErrors = payload.data?.carrierServiceCreate?.userErrors ?? [];
    if (created) {
      createdId = created.id;
    } else if (userErrors.length > 0 || payload.errors) {
      // Shop plan lacks CCS (or carrier services blocked) → definitive answer.
      return "CCS_OFF";
    }
  } catch (error) {
    probeError = error; // transport/auth failure → inconclusive
  }

  if (createdId) {
    // Immediate teardown — the probe must leave no trace.
    try {
      await admin.graphql(DELETE_CARRIER_SERVICE, { variables: { id: createdId } });
    } catch (error) {
      console.error(`probe teardown failed for shop ${shopId} (tolerated):`, error);
    }
    return "ELIGIBLE";
  }
  if (probeError) {
    return "ERROR";
  }
  return "CCS_OFF";
}
