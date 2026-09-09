import { Icon, Tooltip } from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";

interface HelpTooltipProps {
  /** The help text shown on hover or keyboard focus. */
  content: string;
}

/**
 * Inline help affordance for headings and custom rows (UX writing rule in
 * docs/INSTRUCTION.md): field-level help stays short in helpText, and every
 * longer explanation rides this info icon inside a Polaris Tooltip so the
 * form stays scannable. Raw span because Box takes no style prop; the span
 * carries the ref Tooltip needs, a help cursor, and a subdued icon color.
 */
function HelpTooltip({ content }: HelpTooltipProps) {
  return (
    <Tooltip content={content} dismissOnMouseOut>
      <span
        style={{
          display: "inline-flex",
			alignItems: "center",
		  justifyContent: "center",
          cursor: "help",
				  color: "var(--p-color-text-secondary)",
		  paddingTop: "5	px",
        }}
      >
        <Icon source={InfoIcon} />
      </span>
    </Tooltip>
  );
}

export default HelpTooltip;
