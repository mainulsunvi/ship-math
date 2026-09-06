/**
 * Mirror-sync tests (review 004/005 §1 REQUIRED: the forced
 * metafieldsSet-failure coverage promised by spec 005 §7.6 / plan Task 6).
 *
 * sync.ts itself is server-bound only through what it imports:
 *   - shopify.server (module-scope shopifyApp → env reads + Prisma session
 *     storage) — vi.mock'ed wholesale;
 *   - db.server via its collaborators function-config.ts and
 *     function-owner.ts — vi.mock'ed with a stub prisma, so the real
 *     database is never touched (no server, no fixture DB needed).
 * The REAL pipeline (buildFunctionConfig → pushFunctionConfig →
 * ensureFunctionOwner) runs; admin.graphql is the stubbed boundary that
 * resolves the admin client in production, programmed per case.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SET_FUNCTION_METAFIELDS } from "../../graphql/metafields";
import { CONFIG_KEY, ConfigTooLargeError } from "../function-config";
import { syncAfterOwnerEnsure, syncMirror, type MirrorSyncReport } from "../sync";

/** Derived from syncMirror's own signature so the cast stays local to tests. */
type SyncAdminClient = Parameters<typeof syncMirror>[0];

const prismaStub = vi.hoisted(function createPrismaStub() {
  return {
    shop: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  };
});

vi.mock("../../shopify.server", function mockShopifyServer() {
  return { authenticate: { admin: vi.fn() } };
});

vi.mock("../../db.server", function mockDbServer() {
  return { default: prismaStub };
});

const SHOP_ID = "shop_sync-test";

/**
 * Row shape covering BOTH findUniqueOrThrow callers: pushFunctionConfig
 * (needs functionOwnerId) and buildFunctionConfig's include query (needs
 * zones/rules/testMode/evaluationMode).
 */
function createShopRow(): Record<string, unknown> {
  return {
    id: SHOP_ID,
    functionOwnerId: "gid://shopify/DeliveryCustomization/99",
    testMode: false,
    evaluationMode: "FIRST_MATCH",
    zones: [],
    rules: [],
  };
}

/** Plain admin object whose graphql fn is a declaration-backed vi.fn, programmed per case. */
function createStubAdmin(): { graphql: ReturnType<typeof vi.fn> } {
  return {
    graphql: vi.fn(function graphql() {
      throw new Error("stubAdmin.graphql was not programmed for this test case");
    }),
  };
}

/** Well-formed metafieldsSet response (no userErrors) as pushFunctionConfig reads it. */
function metafieldsSetResponse(): { json: () => Promise<unknown> } {
  return {
    json: function json() {
      return Promise.resolve({
        data: {
          metafieldsSet: {
            metafields: [{ id: "gid://shopify/Metafield/1" }],
            userErrors: [],
          },
        },
      });
    },
  };
}

/** The regression the review demands: report shape asserted on EVERY path. */
function expectMirrorReportShape(report: MirrorSyncReport): void {
  expect(typeof report.ok).toBe("boolean");
  expect(Object.keys(report.variablesTruncated).sort()).toEqual(["ct", "pt"]);
  expect(typeof report.variablesTruncated.pt).toBe("boolean");
  expect(typeof report.variablesTruncated.ct).toBe("boolean");
  expect(Array.isArray(report.excluded)).toBe(true);
  for (const entry of report.excluded) {
    expect(typeof entry.ruleId).toBe("string");
    expect(typeof entry.reason).toBe("string");
  }
}

beforeEach(function resetStubs() {
  vi.clearAllMocks();
  prismaStub.shop.findUniqueOrThrow.mockResolvedValue(createShopRow());
  prismaStub.shop.update.mockResolvedValue({});
});

describe("syncMirror", function () {
  it("success: report.ok true, bytes/syncedAt present, truncation + exclusion carried from the pushed result", async function () {
    const shopRow = createShopRow();
    // Enabled rule whose destination condition the Function lane cannot
    // mirror → buildFunctionConfig excludes it; the report must carry that
    // exclusion through verbatim (not fabricate neutral defaults).
    shopRow.rules = [
      {
        id: "rule-1",
        kind: "HIDE",
        enabled: true,
        priority: 1,
        stopOnMatch: false,
        zoneId: null,
        conditions: JSON.stringify({
          combinator: "AND",
          conditions: [{ field: "destination_country", operator: "eq", value: "US" }],
        }),
        action: "{}",
      },
    ];
    prismaStub.shop.findUniqueOrThrow.mockResolvedValue(shopRow);

    const admin = createStubAdmin();
    admin.graphql.mockResolvedValue(metafieldsSetResponse());

    const report = await syncMirror(admin as unknown as SyncAdminClient, SHOP_ID);

    expectMirrorReportShape(report);
    expect(report.ok).toBe(true);
    expect(typeof report.bytes).toBe("number");
    expect(report.bytes).toBeGreaterThan(0);
    expect(typeof report.syncedAt).toBe("string");
    expect(report.excluded).toEqual([
      { ruleId: "rule-1", reason: "uses destination/collection conditions not supported by the Function lane" },
    ]);
    expect(report.variablesTruncated).toEqual({ pt: false, ct: false });
    // The push actually happened: metafieldsSet fired and the shop row got stamped.
    expect(admin.graphql).toHaveBeenCalledTimes(1);
    expect(admin.graphql.mock.calls[0][0]).toBe(SET_FUNCTION_METAFIELDS);
    const call = admin.graphql.mock.calls[0] as unknown as [
      string,
      { variables: { metafields: Array<{ key: string; value: string }> } },
    ];
    const configMetafield = call[1].variables.metafields.find(function byKey(entry) {
      return entry.key === CONFIG_KEY;
    });
    expect(configMetafield).toBeDefined();
    // The unsupported rule never reaches the mirrored wire JSON.
    expect((JSON.parse(configMetafield!.value) as { r?: unknown }).r).toBeUndefined();
    expect(prismaStub.shop.update).toHaveBeenCalledTimes(1);
  });

  it("forced metafieldsSet failure with ConfigTooLargeError: ok false, tooLarge true, neutral defaults", async function () {
    const admin = createStubAdmin();
    const tooLarge = new ConfigTooLargeError(12000);
    admin.graphql.mockRejectedValue(tooLarge);

    const report = await syncMirror(admin as unknown as SyncAdminClient, SHOP_ID);

    expectMirrorReportShape(report);
    expect(report.ok).toBe(false);
    expect(report.tooLarge).toBe(true);
    expect(report.error).toBe(tooLarge.message);
    expect(report.error).toContain("12000");
    expect(report.variablesTruncated).toEqual({ pt: false, ct: false });
    expect(report.excluded).toEqual([]);
    // The Prisma commit stands: a failed push must not stamp the shop row.
    expect(prismaStub.shop.update).not.toHaveBeenCalled();
  });

  it("generic push failure: ok false, tooLarge absent", async function () {
    const admin = createStubAdmin();
    admin.graphql.mockRejectedValue(new Error("metafieldsSet failed: network down"));

    const report = await syncMirror(admin as unknown as SyncAdminClient, SHOP_ID);

    expectMirrorReportShape(report);
    expect(report.ok).toBe(false);
    expect(report.tooLarge).toBeUndefined();
    expect(report.error).toBe("metafieldsSet failed: network down");
    expect(report.variablesTruncated).toEqual({ pt: false, ct: false });
    expect(report.excluded).toEqual([]);
    expect(prismaStub.shop.update).not.toHaveBeenCalled();
  });
});

describe("syncAfterOwnerEnsure", function () {
  it("owner creation throwing: ok false with neutral defaults, mirror never pushed", async function () {
    const shopRow = createShopRow();
    shopRow.functionOwnerId = null; // forces ensureFunctionOwner down the create path
    prismaStub.shop.findUniqueOrThrow.mockResolvedValue(shopRow);

    const admin = createStubAdmin();
    admin.graphql.mockRejectedValue(new Error("deliveryCustomizationCreate failed: access denied"));

    const report = await syncAfterOwnerEnsure(admin as unknown as SyncAdminClient, SHOP_ID);

    expectMirrorReportShape(report);
    expect(report.ok).toBe(false);
    expect(report.error).toBe("deliveryCustomizationCreate failed: access denied");
    expect(report.tooLarge).toBeUndefined();
    expect(report.variablesTruncated).toEqual({ pt: false, ct: false });
    expect(report.excluded).toEqual([]);
    // Exactly the owner-create call ran; the mirror push and the stamp did not.
    expect(admin.graphql).toHaveBeenCalledTimes(1);
    expect(prismaStub.shop.update).not.toHaveBeenCalled();
  });
});
