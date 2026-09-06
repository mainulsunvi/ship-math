import { useState } from "react";
import { Banner, BlockStack, List, Text } from "@shopify/polaris";
import type { MirrorSyncReport } from "../../lib/sync";

/**
 * Success-path mirror-sync warnings shared by app._index and app.zones: the
 * push succeeded, but the report says the mirrored wire config is lossy.
 *  - variablesTruncated: input-variable tag lists cap at 100 tags; dropped
 *    tags mean tag conditions may not match at checkout.
 *  - excluded: rules/fields left out of the wire config by the byte budget.
 * Renders nothing for failed syncs (the critical "mirror out of date" banner
 * owns failures) or when the report is clean. Each banner is dismissible for
 * its exact report content; a changed report re-shows it.
 */

/** Visible exclusion reasons before collapsing into a "+N more" line. */
const MAX_VISIBLE_REASONS = 5;

interface SyncReportWarningsProps {
  sync?: MirrorSyncReport | null;
}

function truncatedTagKinds(sync: MirrorSyncReport): Array<"product" | "customer"> {
  const kinds: Array<"product" | "customer"> = [];
  if (sync.variablesTruncated.pt) {
    kinds.push("product");
  }
  if (sync.variablesTruncated.ct) {
    kinds.push("customer");
  }
  return kinds;
}

function dedupeExclusionReasons(sync: MirrorSyncReport): string[] {
  const reasons: string[] = [];
  for (const entry of sync.excluded) {
    if (!reasons.includes(entry.reason)) {
      reasons.push(entry.reason);
    }
  }
  return reasons;
}

export default function SyncReportWarnings({ sync }: SyncReportWarningsProps) {
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!sync || sync.ok !== true) {
    return null;
  }

  const tagKinds = truncatedTagKinds(sync);
  const reasons = dedupeExclusionReasons(sync);
  if (tagKinds.length === 0 && reasons.length === 0) {
    return null;
  }

  const visibleReasons = reasons.slice(0, MAX_VISIBLE_REASONS);
  const hiddenReasonCount = reasons.length - visibleReasons.length;
  const tagsSignature = `tags:${tagKinds.join(",")}`;
  const excludedSignature = `excluded:${reasons.join("|")}`;

  return (
    <>
      {tagKinds.length > 0 && dismissed !== tagsSignature ? (
        <Banner
          tone="warning"
          title="Tag list exceeded the 100-tag input limit"
          onDismiss={function dismissTags() {
            setDismissed(tagsSignature);
          }}
        >
          <Text as="p" variant="bodySm">
            The sync succeeded, but the {tagKinds.join(" and ")} tag list sent to checkout was
            truncated at 100 tags. Tag conditions may not match at checkout for the dropped tags —
            reduce the number of distinct tags used in rules, or split large rules into smaller
            ones.
          </Text>
        </Banner>
      ) : null}
      {reasons.length > 0 && dismissed !== excludedSignature ? (
        <Banner
          tone="warning"
          title={`${sync.excluded.length} ${sync.excluded.length === 1 ? "rule" : "rules"} excluded from the checkout mirror`}
          onDismiss={function dismissExclusions() {
            setDismissed(excludedSignature);
          }}
        >
          <BlockStack gap="200">
            <Text as="p" variant="bodySm">
              The sync succeeded, but these did not fit in the config pushed to checkout (byte
              budget), so checkout is running without them:
            </Text>
            <List>
              {visibleReasons.map(function reasonItem(reason) {
                return <List.Item key={reason}>{reason}</List.Item>;
              })}
            </List>
            {hiddenReasonCount > 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                +{hiddenReasonCount} more {hiddenReasonCount === 1 ? "reason" : "reasons"} not
                shown.
              </Text>
            ) : null}
          </BlockStack>
        </Banner>
      ) : null}
    </>
  );
}
