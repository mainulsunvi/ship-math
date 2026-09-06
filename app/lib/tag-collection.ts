/**
 * Pure tag collection for the Function input-query variables metafield
 * (spec 002 §A1). Extracted from function-config.ts so vitest can exercise it
 * directly — that module imports Prisma/Shopify servers; this module has zero
 * runtime imports (config-schema types are type-only and erased at build).
 *
 * Platform cap: each input-variables list variable (`pt`, `ct`) holds at most
 * 100 elements — the same limit `InputVariablesSchema` enforces. When more
 * distinct tags are referenced, the FIRST 100 win. The order is deterministic:
 * rule iteration (priority asc, decided by the caller) → condition order
 * within the tree (depth-first) → value order within each condition's array.
 * Dropped tags are reported via the returned `truncated` flags so callers can
 * surface the loss instead of silently mismatching in the Function.
 */

import type { Condition, ConditionGroup } from "./config-schema";

/** Platform limit: ≤100 elements per input-variables list variable. */
export const MAX_TAGS_PER_LIST = 100;

/** Which lists hit the cap and dropped at least one NEW (unseen) tag. */
export interface TagTruncation {
  pt: boolean;
  ct: boolean;
}

export interface TagCollectionResult {
  truncated: TagTruncation;
}

/**
 * Collect the distinct product/customer tags referenced by a stored condition
 * tree into `productTags` / `customerTags` (mutated in place, as before).
 *
 * Values are collected regardless of operator — that is the pre-existing
 * semantic for single strings (`eq`, `contains`, `not_in`, …): the Function
 * compares against the `pt`/`ct` variables for every operator, so `not_in`
 * tag lists must land in the variables payload exactly like `in` lists.
 * String[] values (the `in` / `not_in` shape per ConditionSchema) are
 * flattened into the same set; previously they were silently dropped, so
 * those rules never matched in the Function.
 */
export function collectTags(
  group: ConditionGroup,
  productTags: Set<string>,
  customerTags: Set<string>,
): TagCollectionResult {
  const truncated: TagTruncation = { pt: false, ct: false };
  collectFromGroup(group, productTags, customerTags, truncated);
  return { truncated };
}

function collectFromGroup(
  group: ConditionGroup,
  productTags: Set<string>,
  customerTags: Set<string>,
  truncated: TagTruncation,
): void {
  for (const node of group.conditions) {
    if ("combinator" in node) {
      collectFromGroup(node as ConditionGroup, productTags, customerTags, truncated);
      continue;
    }
    const condition = node as Condition;
    if (condition.field !== "product_tag" && condition.field !== "customer_tag") {
      continue;
    }
    const key: keyof TagTruncation = condition.field === "product_tag" ? "pt" : "ct";
    const target = condition.field === "product_tag" ? productTags : customerTags;
    if (Array.isArray(condition.value)) {
      for (const tag of condition.value) {
        if (typeof tag === "string" && addTag(target, tag)) {
          truncated[key] = true;
        }
      }
      continue;
    }
    if (typeof condition.value === "string" && addTag(target, condition.value)) {
      truncated[key] = true;
    }
  }
}

/**
 * Insert `tag` unless already present or the list is full. Returns true when
 * a NEW tag was dropped by the cap — re-adding an existing tag loses nothing
 * and must not raise the flag.
 */
function addTag(target: Set<string>, tag: string): boolean {
  if (target.has(tag)) {
    return false;
  }
  if (target.size >= MAX_TAGS_PER_LIST) {
    return true;
  }
  target.add(tag);
  return false;
}
