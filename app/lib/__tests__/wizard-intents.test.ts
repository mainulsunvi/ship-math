/**
 * Setup-wizard route-action integration tests (spec 003, plan Task 4).
 *
 * The REAL fixture DB backs every Prisma write/read (db.server untouched —
 * SHIPMATH_TEST_DATABASE_URL via vitest.global-setup.ts). Only the outer
 * Shopify boundaries are stubbed:
 *   - shopify.server: wholesale vi.mock per the sync.test.ts pattern, with
 *     authenticate.admin resolving `{ session, admin }` for the fixture
 *     domain; the stub admin's graphql is programmed per case (owner
 *     LIST/CREATE + metafieldsSet — response shapes copied from sync.test.ts
 *     helpers).
 *   - services/carrier-registration: vi.fn spies for probeCcs +
 *     ensureCarrierService — criterion 2's "asserted via test double".
 *
 * Route module import: same pattern as carrierrates-route.test.ts (a .tsx
 * route imported into the node vitest environment; component code is never
 * rendered, so React/Polaris imports are inert).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../../db.server";
import { action, loader } from "../../routes/app._index";
import { CONFIG_KEY, VARIABLES_KEY } from "../../lib/function-config";
import { SOFT_CAP_BYTES } from "../../lib/budget";

const adminAuthMock = vi.hoisted(function createAdminAuthMock() {
  return vi.fn();
});

const carrierSpies = vi.hoisted(function createCarrierSpies() {
  return { probeCcs: vi.fn(), ensureCarrierService: vi.fn() };
});

vi.mock("../../shopify.server", function mockShopifyServer() {
  return { authenticate: { admin: adminAuthMock } };
});

vi.mock("../../services/carrier-registration", function mockCarrierRegistration() {
  return carrierSpies;
});

const DOMAIN = "wizard-fixture.myshopify.com";
/** Pre-registered owner GID — stub LIST responses return it (reuse path). */
const OWNER_GID = "gid://shopify/DeliveryCustomization/55";

interface GraphqlCall {
  query: string;
  variables: Record<string, unknown>;
}

interface WizardReply {
  ok?: boolean;
  message?: string;
  sync?: { ok: boolean; error?: string };
  fieldErrors?: Record<string, string>;
  zone?: { id: string; name: string };
  rule?: { id: string; name: string };
}

function jsonResponse(payload: unknown): { json: () => Promise<unknown> } {
  return {
    json: function json() {
      return Promise.resolve(payload);
    },
  };
}

function createStubAdmin(options: { failMetafieldsSet?: boolean } = {}) {
  const calls: GraphqlCall[] = [];
  const graphql = vi.fn(function graphql(query: string, opts?: { variables?: Record<string, unknown> }) {
    calls.push({ query, variables: opts?.variables ?? {} });
    if (query.includes("metafieldsSet")) {
      if (options.failMetafieldsSet) {
        return Promise.reject(new Error("metafieldsSet failed: network down"));
      }
      return Promise.resolve(
        jsonResponse({
          data: { metafieldsSet: { metafields: [{ id: "gid://shopify/Metafield/1" }], userErrors: [] } },
        }),
      );
    }
    if (query.includes("deliveryCustomizationCreate")) {
      return Promise.resolve(
        jsonResponse({
          data: {
            deliveryCustomizationCreate: {
              deliveryCustomization: {
                id: "gid://shopify/DeliveryCustomization/77",
                title: "ShipMath delivery rules",
                enabled: true,
              },
              userErrors: [],
            },
          },
        }),
      );
    }
    if (query.includes("deliveryCustomizations")) {
      return Promise.resolve(
        jsonResponse({
          data: {
            deliveryCustomizations: { nodes: [{ id: OWNER_GID, title: "ShipMath delivery rules", enabled: true }] },
          },
        }),
      );
    }
    if (query.includes("ShopDetails")) {
      // First-load plan backfill (loader) for fresh/reinstalled shops.
      return Promise.resolve(
        jsonResponse({
          data: {
            shop: {
              name: "Wizard Fixture Shop",
              plan: { displayName: "Basic", partnerDevelopment: false, shopifyPlus: false },
            },
          },
        }),
      );
    }
    return Promise.reject(new Error(`stubAdmin.graphql was not programmed for: ${query.slice(0, 80)}`));
  });
  return { admin: { graphql }, calls, graphql };
}

function useStubAdmin(options: { failMetafieldsSet?: boolean } = {}) {
  const stub = createStubAdmin(options);
  adminAuthMock.mockResolvedValue({ session: { shop: DOMAIN }, admin: stub.admin });
  return stub;
}

function metafieldsSetCalls(calls: GraphqlCall[]): GraphqlCall[] {
  return calls.filter(function isMetafieldsSet(call) {
    return call.query.includes("metafieldsSet");
  });
}

function postForm(entries: Record<string, string>): Request {
  return new Request("http://localhost/app?index", { method: "POST", body: new URLSearchParams(entries) });
}

async function runAction(request: Request): Promise<{ status: number; body: WizardReply }> {
  const response = await action({ request, params: {}, context: {} } as unknown as ActionFunctionArgs);
  return { status: response.status, body: (await response.json()) as WizardReply };
}

async function runLoader(): Promise<Record<string, unknown>> {
  const response = await loader({
    request: new Request("http://localhost/app?index"),
    params: {},
    context: {},
  } as unknown as LoaderFunctionArgs);
  return (await response.json()) as Record<string, unknown>;
}

interface ShopOverrides {
  plan?: string | null;
  isDevShop?: boolean;
  functionOwnerId?: string | null;
}

/** name is always set so the loader's first-load plan backfill never fires. */
async function createWizardShop(overrides: ShopOverrides = {}): Promise<string> {
  const shop = await prisma.shop.create({
    data: {
      shopDomain: DOMAIN,
      name: "Wizard Fixture Shop",
      plan: overrides.plan ?? null,
      isDevShop: overrides.isDevShop ?? false,
      functionOwnerId: overrides.functionOwnerId ?? null,
    },
  });
  return shop.id;
}

async function seedDisabledRule(shopId: string): Promise<string> {
  const rule = await prisma.shippingRule.create({
    data: {
      shopId,
      name: "Hide pickup draft",
      kind: "HIDE",
      enabled: false,
      priority: 1,
      stopOnMatch: false,
      zoneId: null,
      conditions: JSON.stringify({ combinator: "AND", conditions: [] }),
      action: JSON.stringify({ target: { method: "PICK_UP" } }),
    },
  });
  return rule.id;
}

async function seedDisabledZone(shopId: string): Promise<string> {
  const zone = await prisma.zone.create({
    data: {
      shopId,
      name: "California draft",
      enabled: false,
      countries: JSON.stringify(["US"]),
      provinces: JSON.stringify(["CA"]),
      postalRules: JSON.stringify([{ id: "p1", mode: "PREFIX", value: "94" }]),
    },
  });
  return zone.id;
}

beforeEach(async function resetDatabaseAndSpies() {
  // Children first, then parents (FK-safe); the real fixture DB only.
  await prisma.auditLog.deleteMany();
  await prisma.requestLog.deleteMany();
  await prisma.shippingRule.deleteMany();
  await prisma.aiUsageDay.deleteMany();
  await prisma.zone.deleteMany();
  await prisma.shop.deleteMany();
  vi.clearAllMocks();
  carrierSpies.ensureCarrierService.mockResolvedValue({
    id: "gid://shopify/CarrierService/9",
    created: true,
  });
});

describe("003 criterion 6 — wizard drafts persist disabled, never push the mirror", function () {
  it("wizard-zone-create: valid form → 200 ok, disabled row, normalized JSON columns, audit, NO sync", async function () {
    const shopId = await createWizardShop();
    const stub = useStubAdmin();

    const { status, body } = await runAction(
      postForm({
        intent: "wizard-zone-create",
        name: "California metro",
        countries: '["us"]',
        provinces: '["ca"]',
        postalRules: '[{"id":"p1","mode":"PREFIX","value":"94"}]',
      }),
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.zone).toMatchObject({ name: "California metro" });
    const zone = await prisma.zone.findFirstOrThrow({ where: { shopId } });
    expect(zone.id).toBe(body.zone?.id);
    expect(zone.enabled).toBe(false); // draft stays disabled until wizard-complete
    expect(JSON.parse(zone.countries)).toEqual(["US"]);
    expect(JSON.parse(zone.provinces)).toEqual(["CA"]);
    expect(JSON.parse(zone.postalRules)).toEqual([{ id: "p1", mode: "PREFIX", value: "94" }]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { shopId } });
    expect(audit.actor).toBe("MERCHANT");
    expect(audit.summary).toBe('Wizard created zone "California metro" (draft, disabled)');
    expect(stub.graphql).not.toHaveBeenCalled(); // drafts never touch the admin API
  });

  it("wizard-zone-create: missing name + no countries → 422 fieldErrors, no row written", async function () {
    const shopId = await createWizardShop();
    useStubAdmin();

    const { status, body } = await runAction(
      postForm({
        intent: "wizard-zone-create",
        name: "   ",
        countries: "[]",
        provinces: "[]",
        postalRules: "[]",
      }),
    );

    expect(status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.fieldErrors?.name).toBe("Zone name is required.");
    expect(body.fieldErrors?.countries).toBe("Select at least one destination country (or worldwide).");
    expect(await prisma.zone.count({ where: { shopId } })).toBe(0);
  });

  it("wizard-rule-create: minimal HIDE rule → 200 ok, disabled draft row with JSON columns, NO sync", async function () {
    const shopId = await createWizardShop();
    const stub = useStubAdmin();

    const { status, body } = await runAction(
      postForm({
        intent: "wizard-rule-create",
        name: "Hide pickup",
        kind: "HIDE",
        priority: "1",
        conditions: '{"combinator":"AND","conditions":[]}',
        action: '{"target":{"method":"PICK_UP"}}',
      }),
    );

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rule).toMatchObject({ name: "Hide pickup" });
    const rule = await prisma.shippingRule.findFirstOrThrow({ where: { shopId } });
    expect(rule.id).toBe(body.rule?.id);
    expect(rule.enabled).toBe(false); // no orphaned enabled rules mid-wizard
    expect(rule.kind).toBe("HIDE");
    expect(rule.uid).toMatch(/^[0-9a-z]{10}$/);
    expect(JSON.parse(rule.conditions)).toEqual({ combinator: "AND", conditions: [] });
    expect(JSON.parse(rule.action)).toEqual({ target: { method: "PICK_UP" } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { shopId } });
    expect(audit.summary).toBe('Wizard created rule "Hide pickup" (draft, disabled)');
    expect(stub.graphql).not.toHaveBeenCalled();
  });

  it("wizard-rule-create: unknown kind → 422 message, no row written", async function () {
    const shopId = await createWizardShop();
    useStubAdmin();

    const { status, body } = await runAction(
      postForm({
        intent: "wizard-rule-create",
        name: "Bad kind",
        kind: "EXPLODE",
        priority: "1",
        conditions: '{"combinator":"AND","conditions":[]}',
        action: '{"target":{"method":"PICK_UP"}}',
      }),
    );

    expect(status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.message).toBe("Unknown rule kind.");
    expect(await prisma.shippingRule.count({ where: { shopId } })).toBe(0);
  });
});

describe("003 criterion 1 — wizard-complete stamps onboardedAt; the loader gate keeps the wizard closed on reload", function () {
  it("completing on an empty shop stamps onboardedAt and pushes the mirror exactly once", async function () {
    const shopId = await createWizardShop({ plan: "Basic", functionOwnerId: OWNER_GID });
    const stub = useStubAdmin();

    const { status, body } = await runAction(postForm({ intent: "wizard-complete" }));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toContain("0 rules and 0 zones enabled");
    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(shop.onboardedAt).toBeInstanceOf(Date);
    expect(metafieldsSetCalls(stub.calls)).toHaveLength(1); // ONE sync push
    expect(carrierSpies.probeCcs).not.toHaveBeenCalled(); // carrier not requested
    expect(carrierSpies.ensureCarrierService).not.toHaveBeenCalled();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { shopId } });
    expect(audit.summary).toBe("Setup wizard completed (0 rules and 0 zones enabled, carrier: not requested)");
  });

  it("loader gate: onboardedAt null before completion (wizard shows), ISO string after (reload stays closed)", async function () {
    const shopId = await createWizardShop({ plan: "Basic", functionOwnerId: OWNER_GID });
    useStubAdmin();

    const before = await runLoader();
    expect(before.onboardedAt).toBeNull(); // fresh install → the wizard is open

    await runAction(postForm({ intent: "wizard-complete" }));

    const after = await runLoader();
    expect(typeof after.onboardedAt).toBe("string"); // reload → wizard does not reopen
    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    expect(new Date(after.onboardedAt as string).toISOString()).toBe(shop.onboardedAt?.toISOString());
  });

  it("uninstall → reinstall: the cascade wipes rules/zones/audit and the wizard reruns on the fresh Shop row", async function () {
    const shopId = await createWizardShop({ plan: "Basic", functionOwnerId: OWNER_GID });
    await seedDisabledRule(shopId);
    await seedDisabledZone(shopId);
    useStubAdmin();
    const { body } = await runAction(postForm({ intent: "wizard-complete" }));
    expect(body.ok).toBe(true);

    // Uninstall: the Shop row dies and the schema cascade takes every child.
    await prisma.shop.delete({ where: { id: shopId } });
    expect(await prisma.shippingRule.count()).toBe(0);
    expect(await prisma.zone.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);

    // Reinstall: the first page load recreates the row (getOrCreateShop),
    // backfills plan/name (loader's ensureShopPlanDetails), and the wizard
    // shows again — onboardedAt is null on the fresh row by design.
    const after = await runLoader();
    expect(after.onboardedAt).toBeNull();
    expect(await prisma.shop.count({ where: { shopDomain: DOMAIN } })).toBe(1);
    const fresh = await prisma.shop.findUniqueOrThrow({ where: { shopDomain: DOMAIN } });
    expect(fresh.plan).toBe("Basic"); // backfilled through the stubbed SHOP_DETAILS
    expect(fresh.onboardedAt).toBeNull();
    expect(fresh.functionOwnerId).toBeNull(); // owner must be re-ensured on next sync
  });

  it("unusually large rule set: the loader paginates at 50 and the wizard gate is unaffected", async function () {
    const shopId = await createWizardShop({ plan: "Basic", functionOwnerId: OWNER_GID });
    useStubAdmin();
    // 55 enabled rules — past the 50-row page boundary (spec 005 criterion 7).
    const bulkRules = [];
    for (let index = 1; index <= 55; index += 1) {
      bulkRules.push({
        shopId,
        name: `Bulk rule ${index}`,
        kind: "HIDE",
        enabled: true,
        priority: index,
        stopOnMatch: false,
        zoneId: null,
        conditions: '{"combinator":"AND","conditions":[]}',
        action: '{"target":{"method":"PICK_UP"}}',
      });
    }
    await prisma.shippingRule.createMany({ data: bulkRules });

    const data = await runLoader();
    expect(data.total).toBe(55);
    expect(data.totalPages).toBe(2);
    expect((data.rules as unknown[]).length).toBe(50); // page 1 only
    expect(data.onboardedAt).toBeNull(); // gate still open — pagination is orthogonal
  });
});

describe("003 — wizard-complete commit semantics (drafts flip on, one push, audits)", function () {
  /** Draft rows created through the REAL wizard intents so their ids land
   * in prefs.wizardDraftRuleIds/wizardDraftZoneIds — completion flips exactly
   * those (003 review REQUIRED finding), never rows disabled elsewhere. */
  async function createDraftsViaWizard(shopId: string): Promise<void> {
    await runAction(
      postForm({
        intent: "wizard-zone-create",
        name: "California draft",
        countries: '["US"]',
        provinces: '["CA"]',
        postalRules: '[{"id":"p1","mode":"PREFIX","value":"94"}]',
      }),
    );
    await runAction(
      postForm({
        intent: "wizard-rule-create",
        name: "Hide pickup draft",
        kind: "HIDE",
        priority: "1",
        conditions: '{"combinator":"AND","conditions":[]}',
        action: '{"target":{"method":"PICK_UP"}}',
      }),
    );
    expect(await prisma.zone.count({ where: { shopId, enabled: false } })).toBe(1);
    expect(await prisma.shippingRule.count({ where: { shopId, enabled: false } })).toBe(1);
  }

  it("drafts created through the wizard are enabled by wizard-complete with exactly ONE sync push", async function () {
    const shopId = await createWizardShop({ plan: "Basic" }); // no owner yet → CREATE path
    await createDraftsViaWizard(shopId);
    const ruleId = (await prisma.shippingRule.findFirstOrThrow({ where: { shopId } })).id;
    const zoneId = (await prisma.zone.findFirstOrThrow({ where: { shopId } })).id;
    const stub = useStubAdmin();

    const { status, body } = await runAction(postForm({ intent: "wizard-complete" }));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toContain("1 rule and 1 zone enabled");
    expect((await prisma.shippingRule.findUniqueOrThrow({ where: { id: ruleId } })).enabled).toBe(true);
    expect((await prisma.zone.findUniqueOrThrow({ where: { id: zoneId } })).enabled).toBe(true);
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).onboardedAt).toBeInstanceOf(Date);
    // Owner creation + exactly one config push.
    expect(metafieldsSetCalls(stub.calls)).toHaveLength(1);
    expect(
      stub.calls.some(function isOwnerCreate(call) {
        return call.query.includes("deliveryCustomizationCreate");
      }),
    ).toBe(true);
    const summaries = (await prisma.auditLog.findMany({ where: { shopId } })).map(function toSummary(row) {
      return row.summary;
    });
    expect(
      summaries.some(function finalAudit(summary) {
        return summary.includes("Setup wizard completed (1 rule and 1 zone enabled");
      }),
    ).toBe(true);
  });

  it("003 review regression — rows disabled OUTSIDE the wizard stay disabled at completion", async function () {
    const shopId = await createWizardShop({ plan: "Basic", functionOwnerId: OWNER_GID });
    await createDraftsViaWizard(shopId); // one wizard draft of each
    const outsiderRuleId = await seedDisabledRule(shopId); // deliberate disable (e.g. seasonal rule off)
    const outsiderZoneId = await seedDisabledZone(shopId); // deliberately off zone
    useStubAdmin();

    const { status, body } = await runAction(postForm({ intent: "wizard-complete" }));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // Only the wizard-recorded drafts flip.
    expect(body.message).toContain("1 rule and 1 zone enabled");
    expect((await prisma.shippingRule.findUniqueOrThrow({ where: { id: outsiderRuleId } })).enabled).toBe(false);
    expect((await prisma.zone.findUniqueOrThrow({ where: { id: outsiderZoneId } })).enabled).toBe(false);
    // Draft lists are cleared so a later Restart setup cannot resurrect stale ids.
    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const prefs = shop.prefs ? (JSON.parse(shop.prefs) as Record<string, unknown>) : {};
    expect(prefs.wizardDraftRuleIds ?? null).toBeNull();
    expect(prefs.wizardDraftZoneIds ?? null).toBeNull();
  });

  it("commit-before-push ordering: a failed sync replies ok:false + report, but drafts stay enabled and onboardedAt stays set", async function () {
    const shopId = await createWizardShop({ plan: "Basic", functionOwnerId: OWNER_GID });
    await createDraftsViaWizard(shopId);
    const ruleId = (await prisma.shippingRule.findFirstOrThrow({ where: { shopId } })).id;
    const zoneId = (await prisma.zone.findFirstOrThrow({ where: { shopId } })).id;
    useStubAdmin({ failMetafieldsSet: true });

    const { status, body } = await runAction(postForm({ intent: "wizard-complete" }));

    expect(status).toBe(200); // a failed push is a REPORT, never a 500
    expect(body.ok).toBe(false);
    expect(body.message).toContain("syncing the checkout Function failed");
    expect(body.sync?.ok).toBe(false);
    expect(body.sync?.error).toContain("metafieldsSet failed: network down");
    // The Prisma commit stands — completion is not rolled back by a push failure.
    expect((await prisma.shippingRule.findUniqueOrThrow({ where: { id: ruleId } })).enabled).toBe(true);
    expect((await prisma.zone.findUniqueOrThrow({ where: { id: zoneId } })).enabled).toBe(true);
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).onboardedAt).toBeInstanceOf(Date);
    // The failed push never stamps functionSyncedAt — the stale banner owns the retry.
    expect((await prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).functionSyncedAt).toBeNull();
  });
});

describe("003 criterion 2 — carrier path gated by plan class (probe asserted via test double)", function () {
  it("Basic plan + carrier requested: probeCcs and ensureCarrierService are NEVER called; informational note returned", async function () {
    await createWizardShop({ plan: "Basic", isDevShop: false, functionOwnerId: OWNER_GID });
    const stub = useStubAdmin();

    const { status, body } = await runAction(postForm({ intent: "wizard-complete", carrier: "1" }));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // THE test double (plan 003 Task 4): a probe would create a junk
    // carrier service row on a FUNCTIONS_ONLY shop — none of that here.
    expect(carrierSpies.probeCcs).not.toHaveBeenCalled();
    expect(carrierSpies.ensureCarrierService).not.toHaveBeenCalled();
    expect(body.message).toContain("Carrier rates need a Shopify plan with carrier calculated shipping");
    expect(metafieldsSetCalls(stub.calls)).toHaveLength(1); // Functions path still synced
  });

  it("criterion 3 — probe says CCS_OFF: no registration, completion still ok via the Functions path", async function () {
    await createWizardShop({ plan: "Advanced Shopify", isDevShop: false, functionOwnerId: OWNER_GID });
    useStubAdmin();
    carrierSpies.probeCcs.mockResolvedValue("CCS_OFF");

    const { status, body } = await runAction(postForm({ intent: "wizard-complete", carrier: "1" }));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(carrierSpies.probeCcs).toHaveBeenCalledTimes(1);
    expect(carrierSpies.ensureCarrierService).not.toHaveBeenCalled();
    expect(body.message).toContain("not available on this store's plan");
    expect(body.message).toContain("delivery rules will handle checkout");
  });

  it("probe inconclusive (ERROR): no registration, completion still ok", async function () {
    await createWizardShop({ plan: "Advanced Shopify", isDevShop: false, functionOwnerId: OWNER_GID });
    useStubAdmin();
    carrierSpies.probeCcs.mockResolvedValue("ERROR");

    const { status, body } = await runAction(postForm({ intent: "wizard-complete", carrier: "1" }));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(carrierSpies.ensureCarrierService).not.toHaveBeenCalled();
    expect(body.message).toContain("could not be verified");
  });

  it("CCS_ELIGIBLE plan + probe ELIGIBLE: ensureCarrierService called exactly once for this shop", async function () {
    const shopId = await createWizardShop({ plan: "Advanced Shopify", isDevShop: false, functionOwnerId: OWNER_GID });
    useStubAdmin();
    carrierSpies.probeCcs.mockResolvedValue("ELIGIBLE");

    const { status, body } = await runAction(postForm({ intent: "wizard-complete", carrier: "1" }));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(carrierSpies.probeCcs).toHaveBeenCalledTimes(1);
    expect(carrierSpies.ensureCarrierService).toHaveBeenCalledTimes(1);
    expect(carrierSpies.ensureCarrierService.mock.calls[0][1]).toBe(shopId);
    expect(body.message).toContain("Carrier rates are set up");
  });

  it("criterion 4 (automatable slice) — dev store completes the carrier registration path", async function () {
    const shopId = await createWizardShop({ plan: null, isDevShop: true, functionOwnerId: OWNER_GID });
    useStubAdmin();
    carrierSpies.probeCcs.mockResolvedValue("ELIGIBLE");

    const { status, body } = await runAction(postForm({ intent: "wizard-complete", carrier: "1" }));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(carrierSpies.ensureCarrierService).toHaveBeenCalledTimes(1);
    expect(carrierSpies.ensureCarrierService.mock.calls[0][1]).toBe(shopId);
    expect(body.message).toContain("Carrier rates are set up");
  });
});

describe("003 criterion 7 — skipped optional steps still push a valid, empty-but-consistent config", function () {
  it("fresh-shop completion pushes a parseable empty config (config + variables metafields) within the byte cap", async function () {
    await createWizardShop({ plan: "Basic", functionOwnerId: OWNER_GID });
    const stub = useStubAdmin();

    const { status, body } = await runAction(postForm({ intent: "wizard-complete" }));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const pushes = metafieldsSetCalls(stub.calls);
    expect(pushes).toHaveLength(1);
    const metafields = (
      pushes[0].variables as { metafields: Array<{ key: string; type: string; value: string }> }
    ).metafields;
    expect(metafields).toHaveLength(2); // function-configuration + input-variables

    const configMetafield = metafields.find(function byKey(entry) {
      return entry.key === CONFIG_KEY;
    });
    expect(configMetafield).toBeDefined();
    expect(configMetafield?.type).toBe("json");
    const parsed = JSON.parse(configMetafield!.value) as Record<string, unknown>;
    // Empty-but-consistent: version 1, schema-default testMode (true → t:1),
    // FIRST_MATCH evaluation mode; no zones, no rules keys.
    expect(parsed).toEqual({ v: 1, t: 1, m: "F" });

    const variablesMetafield = metafields.find(function byKey(entry) {
      return entry.key === VARIABLES_KEY;
    });
    expect(JSON.parse(variablesMetafield!.value)).toEqual({}); // no tags → empty variables

    expect(Buffer.byteLength(configMetafield!.value, "utf8")).toBeLessThanOrEqual(SOFT_CAP_BYTES);
  });
});
