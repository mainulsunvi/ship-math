/**
 * Function owner lifecycle (architecture.md §A1):
 * ShipMath keeps exactly ONE delivery customization per shop, created by the
 * app (never the merchant), with its GID stored on Shop.functionOwnerId.
 * ensureFunctionOwner() is idempotent and self-heals merchant deletion.
 */

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
/**
 * The package does not re-export its admin client type; derive it from
 * `authenticate.admin` so callers pass exactly what the Remix SDK returns.
 */
type AdminApiClient = Awaited<ReturnType<typeof authenticate.admin>>["admin"];
import {
  CREATE_DELIVERY_CUSTOMIZATION,
  LIST_DELIVERY_CUSTOMIZATIONS,
} from "../graphql/delivery-customization";

export const FUNCTION_HANDLE = "delivery-customization";
export const OWNER_TITLE = "ShipMath delivery rules";

interface CreateResult {
  data?: {
    deliveryCustomizationCreate?: {
      deliveryCustomization?: { id: string; title: string; enabled: boolean };
      userErrors?: Array<{ field?: string[]; message: string }>;
    };
  };
  errors?: unknown;
}

interface ListResult {
  data?: {
    deliveryCustomizations?: {
      nodes?: Array<{ id: string; title: string; enabled: boolean }>;
    };
  };
  errors?: unknown;
}

export interface EnsureOwnerResult {
  ownerId: string;
  created: boolean;
  enabled: boolean;
}

/**
 * Guarantee a delivery customization owner exists for the shop:
 *   1. If we have a stored GID that still resolves → reuse it.
 *   2. Otherwise create one and persist the GID.
 * Called from the wizard completion (spec 003), the settings loader when the
 * GID is missing, and before every config sync.
 */
export async function ensureFunctionOwner(
  admin: AdminApiClient,
  shopId: string,
): Promise<EnsureOwnerResult> {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });

  if (shop.functionOwnerId) {
    const listResponse = await admin.graphql(LIST_DELIVERY_CUSTOMIZATIONS, {
      variables: { first: 25 },
    });
    const listJson = (await listResponse.json()) as ListResult;
    const nodes = listJson.data?.deliveryCustomizations?.nodes ?? [];
    const existing = nodes.find((node) => node.id === shop.functionOwnerId);
    if (existing) {
      return { ownerId: existing.id, created: false, enabled: existing.enabled };
    }
    // Fall through: stored owner no longer resolves (merchant deleted it) → recreate + resync below.
  }

  const createResponse = await admin.graphql(CREATE_DELIVERY_CUSTOMIZATION, {
    variables: {
      input: {
        functionHandle: FUNCTION_HANDLE,
        title: OWNER_TITLE,
        enabled: true,
      },
    },
  });
  const createJson = (await createResponse.json()) as CreateResult;
  const created = createJson.data?.deliveryCustomizationCreate?.deliveryCustomization;
  const userErrors = createJson.data?.deliveryCustomizationCreate?.userErrors ?? [];
  if (!created || userErrors.length > 0 || createJson.errors) {
    throw new Error(
      `deliveryCustomizationCreate failed: ${JSON.stringify(userErrors.length ? userErrors : createJson.errors)}`,
    );
  }

  await prisma.shop.update({
    where: { id: shopId },
    data: { functionOwnerId: created.id, functionSyncedAt: null },
  });

  return { ownerId: created.id, created: true, enabled: created.enabled };
}
