import { Icon } from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";

/** Compact stepper entry (full step names live in each step's heading). */
export interface WizardProgressStep {
  id: string;
  label: string;
}

interface WizardProgressProps {
  steps: WizardProgressStep[];
  currentIndex: number;
}

/**
 * Setup wizard progress stepper (2026-09-10 polished-modal redesign):
 * numbered dots in equal-width columns across the top of the wizard modal.
 * Completed dots fill with the brand accent and swap to a check, the current
 * dot gets an accent ring, upcoming dots stay muted. Connectors between
 * dots are drawn by CSS (.sm-wizard-step::before) so they touch both
 * circles regardless of label width; they fill with the accent once the
 * walk has passed them. Purely presentational: navigation stays on the
 * modal footer buttons. The nav is aria-labelled and the current step
 * carries aria-current="step".
 */
function WizardProgress({ steps, currentIndex }: WizardProgressProps) {
  return (
    <nav aria-label="Setup progress" className="sm-wizard-steps">
      {steps.map(function renderStep(step, index) {
        const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
        return (
          <span
            key={step.id}
            className={`sm-wizard-step sm-wizard-step--${state}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="sm-wizard-dot">
              {state === "done" ? <Icon source={CheckIcon} /> : index + 1}
            </span>
            <span className="sm-wizard-label">{step.label}</span>
          </span>
        );
      })}
    </nav>
  );
}

export default WizardProgress;
