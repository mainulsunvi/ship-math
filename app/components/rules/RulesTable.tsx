import {
  Badge,
  Button,
  ButtonGroup,
  DataTable,
  Text,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DeleteIcon,
  DuplicateIcon,
  EditIcon,
} from "@shopify/polaris-icons";
import type { RuleKind } from "../../lib/config-schema";
import Switch from "../ui/Switch";
import KindChip from "./KindChip";

/**
 * Rules table (spec 005 Task 4) — name, kind, enable toggle, priority, zone,
 * stop-on-match, behavior (derived from the shop evaluation mode, criterion 5),
 * and the edit/duplicate/delete/move-up/move-down actions.
 * All mutations are posted by the owning route via useFetcher; this component
 * only raises callbacks, and no optimistic state is kept (criterion 6).
 */

export interface RuleRow {
  id: string;
  /** Short public uid — route addresses for edit (/app/rules/<uid>/edit). */
  uid?: string;
  name: string;
  kind: RuleKind;
  enabled: boolean;
  priority: number;
  stopOnMatch: boolean;
  zoneId: string | null;
  /** Stored ConditionGroup tree (parsed in the loader, re-validated on save).
   * Optional because Remix Jsonify loosens required-ness through serialization.
   */
  conditions?: unknown;
  /** Stored action JSON (CarrierRateAction or OptionTarget action).
   * Optional for the same Jsonify reason as conditions.
   */
  action?: unknown;
}

interface RulesTableProps {
  rules: RuleRow[];
  zones: Array<{ id: string; name: string }>;
  busy: boolean;
  /** Shop-level evaluation mode (spec 005 criterion 5) — drives the Behavior column. */
  evaluationMode?: "FIRST_MATCH" | "ALL_MATCH";
  onEdit(rule: RuleRow): void;
  onDelete(rule: RuleRow): void;
  onToggle(rule: RuleRow, enabled: boolean): void;
  onMove(rule: RuleRow, direction: "up" | "down"): void;
  onDuplicate(rule: RuleRow): void;
}

/**
 * Short label for the Behavior column (spec 005 criterion 5) — derived from
 * the shop-level evaluation mode; "—" when the mode is unknown.
 */
function behaviorLabel(mode: string | undefined): string {
  if (mode === "FIRST_MATCH") {
    return "Stops at first match";
  }
  if (mode === "ALL_MATCH") {
    return "All matches apply";
  }
  return "—";
}

export default function RulesTable({
  rules,
  zones,
  busy,
  evaluationMode,
  onEdit,
  onDelete,
  onToggle,
  onMove,
  onDuplicate,
}: RulesTableProps) {
  const zoneNames = new Map(zones.map(function toEntry(zone) {
    return [zone.id, zone.name] as const;
  }));

  const rows = rules.map(function toRowCells(rule, index) {
    const zoneName = rule.zoneId ? (zoneNames.get(rule.zoneId) ?? "—") : "—";
    return [
      <Text key="name" as="span" variant="bodyMd">
        {rule.name}
      </Text>,
      <KindChip key="kind" kind={rule.kind} />,
      <Switch
        key="enabled"
        label={`Enable ${rule.name}`}
        labelHidden
        checked={rule.enabled}
        disabled={busy}
        onChange={function handleToggle(next: boolean) {
          onToggle(rule, next);
        }}
      />,
      rule.priority,
      zoneName,
      rule.stopOnMatch ? (
        <Badge key="stop" tone="info">stops</Badge>
      ) : (
        <Text key="stop-none" as="span" variant="bodySm" tone="subdued">
          —
        </Text>
      ),
      behaviorLabel(evaluationMode),
      <ButtonGroup key="actions">
        <Button
          icon={ChevronUpIcon}
          variant="plain"
          accessibilityLabel={`Move ${rule.name} up`}
          disabled={busy || index === 0}
          onClick={function moveUp() {
            onMove(rule, "up");
          }}
        />
        <Button
          icon={ChevronDownIcon}
          variant="plain"
          accessibilityLabel={`Move ${rule.name} down`}
          disabled={busy || index === rules.length - 1}
          onClick={function moveDown() {
            onMove(rule, "down");
          }}
        />
        <Button
          icon={EditIcon}
          variant="plain"
          accessibilityLabel={`Edit ${rule.name}`}
          disabled={busy}
          onClick={function edit() {
            onEdit(rule);
          }}
        />
        <Button
          icon={DuplicateIcon}
          variant="plain"
          accessibilityLabel={`Duplicate ${rule.name}`}
          disabled={busy}
          onClick={function duplicate() {
            onDuplicate(rule);
          }}
        />
        <Button
          icon={DeleteIcon}
          variant="plain"
          tone="critical"
          accessibilityLabel={`Delete ${rule.name}`}
          disabled={busy}
          onClick={function remove() {
            onDelete(rule);
          }}
        />
      </ButtonGroup>,
    ];
  });

  return (
    <DataTable
      columnContentTypes={["text", "text", "text", "numeric", "text", "text", "text", "text"]}
      headings={["Rule", "Kind", "Enabled", "Priority", "Zone", "Stop on match", "Behavior", "Actions"]}
      rows={rows}
      verticalAlign="middle"
      increasedTableDensity
    />
  );
}
