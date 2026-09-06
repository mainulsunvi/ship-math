/**
 * Tests for the pure tag collector (app/lib/tag-collection.ts) that feeds the
 * Function input-query variables metafield (`pt` / `ct`).
 *
 * Semantics under test (plan 004-005 follow-up): `in` / `not_in` conditions on
 * product_tag / customer_tag carry string[] values per ConditionSchema. The
 * collector is operator-agnostic — matching the pre-existing single-string
 * path — because the Function compares against the `pt`/`ct` variables for
 * every operator, so `not_in` tag lists belong in the variables payload
 * exactly like `in` lists.
 */

import { describe, expect, it } from "vitest";
import { collectTags, MAX_TAGS_PER_LIST } from "../tag-collection";
import type { Condition, ConditionGroup } from "../config-schema";

function group(combinator: "AND" | "OR", conditions: ConditionGroup["conditions"]): ConditionGroup {
  return { combinator, conditions };
}

function condition(
  field: Condition["field"],
  operator: Condition["operator"],
  value: Condition["value"],
): Condition {
  return { field, operator, value };
}

describe("collectTags", function () {
  it("collects single-string product_tag values (existing behavior preserved)", function () {
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    const result = collectTags(
      group("AND", [condition("product_tag", "eq", "express-only")]),
      productTags,
      customerTags,
    );
    expect(Array.from(productTags)).toEqual(["express-only"]);
    expect(productTags.size).toBe(1);
    expect(result.truncated.pt).toBe(false);
    expect(result.truncated.ct).toBe(false);
  });

  it("collects single-string customer_tag values (existing behavior preserved)", function () {
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    const result = collectTags(
      group("AND", [condition("customer_tag", "eq", "vip")]),
      productTags,
      customerTags,
    );
    expect(Array.from(customerTags)).toEqual(["vip"]);
    expect(productTags.size).toBe(0);
    expect(result.truncated.ct).toBe(false);
  });

  it("still collects single-string tags on not_in (operator-agnostic, pre-existing semantic)", function () {
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    collectTags(
      group("AND", [condition("product_tag", "not_in", "oversize")]),
      productTags,
      customerTags,
    );
    expect(Array.from(productTags)).toEqual(["oversize"]);
  });

  it("flattens string[] values from `in` conditions into pt", function () {
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    const result = collectTags(
      group("AND", [condition("product_tag", "in", ["heavy", "fragile", "cold-chain"])]),
      productTags,
      customerTags,
    );
    expect(Array.from(productTags)).toEqual(["heavy", "fragile", "cold-chain"]);
    expect(result.truncated.pt).toBe(false);
  });

  it("flattens string[] values from `not_in` conditions into ct (same variables payload as `in`)", function () {
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    const result = collectTags(
      group("OR", [condition("customer_tag", "not_in", ["wholesale", "employee"])]),
      productTags,
      customerTags,
    );
    expect(Array.from(customerTags)).toEqual(["wholesale", "employee"]);
    expect(result.truncated.ct).toBe(false);
  });

  it("deduplicates across conditions and across string/array forms", function () {
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    collectTags(
      group("AND", [
        condition("product_tag", "eq", "heavy"),
        condition("product_tag", "in", ["heavy", "fragile"]),
        condition("product_tag", "not_in", ["fragile", "oversize"]),
      ]),
      productTags,
      customerTags,
    );
    expect(Array.from(productTags)).toEqual(["heavy", "fragile", "oversize"]);
  });

  it("traverses nested condition groups", function () {
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    collectTags(
      group("AND", [
        condition("subtotal", "gte", 50),
        group("OR", [
          condition("product_tag", "in", ["nested-a"]),
          group("AND", [condition("customer_tag", "eq", "nested-ct")]),
        ]),
      ]),
      productTags,
      customerTags,
    );
    expect(Array.from(productTags)).toEqual(["nested-a"]);
    expect(Array.from(customerTags)).toEqual(["nested-ct"]);
  });

  it("ignores non-tag fields and non-string tag values", function () {
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    const result = collectTags(
      group("AND", [
        condition("subtotal", "gt", 100),
        condition("weight", "lte", 5),
        condition("logged_in", "eq", true),
        condition("vendor", "eq", "Acme"),
        condition("product_tag", "in", ["keep-me", 42] as unknown as string[]),
      ]),
      productTags,
      customerTags,
    );
    expect(Array.from(productTags)).toEqual(["keep-me"]);
    expect(productTags.size).toBe(1);
    expect(customerTags.size).toBe(0);
    expect(result.truncated.pt).toBe(false);
  });

  it("separates product and customer tags in mixed string + array conditions", function () {
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    collectTags(
      group("AND", [
        condition("product_tag", "eq", "p-string"),
        condition("product_tag", "in", ["p-arr-1", "p-arr-2"]),
        condition("customer_tag", "not_in", ["c-arr-1"]),
        condition("customer_tag", "eq", "c-string"),
      ]),
      productTags,
      customerTags,
    );
    expect(Array.from(productTags)).toEqual(["p-string", "p-arr-1", "p-arr-2"]);
    expect(Array.from(customerTags)).toEqual(["c-arr-1", "c-string"]);
  });

  it("keeps the first 100 distinct tags by condition-then-value order when the cap is hit", function () {
    const first = Array.from({ length: 60 }, function (_, i) {
      return `a${i}`;
    });
    const second = Array.from({ length: 90 }, function (_, i) {
      return `b${i}`;
    });
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    const result = collectTags(
      group("AND", [
        condition("product_tag", "in", first),
        condition("product_tag", "not_in", second),
      ]),
      productTags,
      customerTags,
    );
    const list = Array.from(productTags);
    expect(MAX_TAGS_PER_LIST).toBe(100);
    expect(productTags.size).toBe(MAX_TAGS_PER_LIST);
    expect(list[0]).toBe("a0");
    expect(list[59]).toBe("a59");
    expect(list[60]).toBe("b0");
    expect(list[99]).toBe("b39");
    expect(list).not.toContain("b40");
    expect(result.truncated.pt).toBe(true);
    expect(result.truncated.ct).toBe(false);
  });

  it("does not flag truncation at exactly the cap", function () {
    const exactly = Array.from({ length: MAX_TAGS_PER_LIST }, function (_, i) {
      return `t${i}`;
    });
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    const result = collectTags(
      group("AND", [condition("product_tag", "in", exactly)]),
      productTags,
      customerTags,
    );
    expect(productTags.size).toBe(MAX_TAGS_PER_LIST);
    expect(result.truncated.pt).toBe(false);
  });

  it("does not flag truncation for duplicates beyond the cap, only for new tags", function () {
    const first = Array.from({ length: MAX_TAGS_PER_LIST }, function (_, i) {
      return `t${i}`;
    });
    const productTags = new Set<string>();
    const customerTags = new Set<string>();
    // Fill the list, then re-reference existing tags: nothing is lost.
    collectTags(
      group("AND", [
        condition("product_tag", "in", first),
        condition("product_tag", "eq", "t0"),
        condition("product_tag", "in", ["t99", "t50"]),
      ]),
      productTags,
      customerTags,
    );
    expect(productTags.size).toBe(MAX_TAGS_PER_LIST);
    let truncatedAfterDuplicates = collectTags(
      group("AND", [condition("product_tag", "eq", "t1")]),
      productTags,
      customerTags,
    ).truncated.pt;
    expect(truncatedAfterDuplicates).toBe(false);

    // One NEW tag beyond the cap: dropped, and the flag rises.
    truncatedAfterDuplicates = collectTags(
      group("AND", [condition("product_tag", "in", ["brand-new"])]),
      productTags,
      customerTags,
    ).truncated.pt;
    expect(productTags.size).toBe(MAX_TAGS_PER_LIST);
    expect(truncatedAfterDuplicates).toBe(true);
  });
});
