import type { MirrorSyncReport } from "../../lib/sync";

/**
 * Shared types + text helpers for the setup wizard steps (spec 003, plan
 * Task 4). Lives outside SetupWizard.tsx so the step components can import
 * them without a circular module graph (steps import the wizard's props
 * types; the wizard imports the steps).
 */

/** Fetcher reply shape for the wizard intents on the dashboard action. */
export interface WizardActionReply {
  ok?: boolean;
  message?: string;
  sync?: MirrorSyncReport;
  /** Present on wizard-zone-create 422 replies (name, countries, postal). */
  fieldErrors?: Record<string, string>;
  /** Present on wizard-zone-create success. */
  zone?: { id: string; name: string };
  /** Present on wizard-rule-create success. */
  rule?: { id: string; name: string };
}

/** Zone summary as serialized by the dashboard loader (id, name, enabled). */
export interface WizardZone {
  id: string;
  name: string;
  enabled: boolean;
}

/** "1 rule" / "2 rules" — merchant-facing counts never use parentheses (UX rules). */
export function pluralCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
