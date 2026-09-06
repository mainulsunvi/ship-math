import type { RuleKind } from "../../lib/config-schema";
import AccentChip from "../ui/AccentChip";

/** Display labels for the four rule kinds (shared table + editor surfaces). */
export const KIND_LABELS: Record<RuleKind, string> = {
  CARRIER_RATE: "Carrier rate",
  HIDE: "Hide",
  RENAME: "Rename",
  MOVE: "Move",
};

/**
 * Rule-kind chip — the accent-styled kind label used in the rules table and
 * beside the rule editor title. Visual only; the authoritative kind union
 * lives in app/lib/config-schema.ts.
 */
function KindChip({ kind }: { kind: RuleKind }) {
  return <AccentChip>{KIND_LABELS[kind]}</AccentChip>;
}

export default KindChip;
