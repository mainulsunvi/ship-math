import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Banner, BlockStack, Link, Modal, Text } from "@shopify/polaris";
import type { PlanClass } from "../../lib/plan";
import type { RuleFormSubmitInput } from "../rules/RuleForm";
import SyncReportWarnings from "../rules/SyncReportWarnings";
import WizardProgress from "./WizardProgress";
import StepWelcome from "./StepWelcome";
import StepPlanGuidance from "./StepPlanGuidance";
import StepZones from "./StepZones";
import type { ZoneFormSubmitInput } from "../zones/ZoneForm";
import StepRates from "./StepRates";
import StepCarrier from "./StepCarrier";
import StepTestMode from "./StepTestMode";
import StepDone from "./StepDone";
import type { WizardActionReply, WizardZone } from "./wizard-shared";

/**
 * Setup wizard (spec 003, plan Task 4) — modal-based multi-step flow shown
 * on the dashboard while Shop.onboardedAt is null. Steps: Welcome, Plan,
 * Zones, Rates, Carrier (CCS_ELIGIBLE/ALL only), Test Mode, Done.
 *
 * 2026-09-10 polished-modal redesign: the modal title is fixed ("Set Up
 * ShipMath"), a WizardProgress stepper across the top shows the dots, each
 * step opens with its own StepHeader (icon tile + heading), and Skip for
 * now moved into the modal footer beside Back. No flow semantics changed.
 *
 * Intent wiring (dashboard action, contract fixed by Backend):
 *   - wizard-zone-create : posted by the inline ZoneForm in the Zones step
 *   - wizard-rule-create : posted from the Rates step through RuleForm
 *   - wizard-complete    : posted by Finish setup, with carrier "1" only
 *                          when the carrier step was offered and left on
 *
 * Abandonment (the X, Skip for now, or navigating away) only hides the modal
 * through local state: onboardedAt stays null so the wizard reappears on the
 * next load, and anything created along the way stays a disabled draft
 * (criterion 6). After a successful wizard-complete the modal closes and a
 * success banner with Simulator/Settings links renders in its place; the
 * dashboard keeps this component mounted (local latch in app._index) so the
 * banner survives the loader revalidation that sets onboardedAt.
 */

interface SetupWizardProps {
  shopName: string | null;
  planClass: PlanClass;
  testMode: boolean;
  zones: WizardZone[];
  draftRules: Array<{ id: string; name: string }>;
}

type WizardStepId = "welcome" | "plan" | "zones" | "rates" | "carrier" | "test-mode" | "done";

interface WizardStep {
  id: WizardStepId;
  /** Compact stepper label (the full heading lives in the step component). */
  label: string;
}

/** Carrier Rates appears only for CCS-capable plans (criterion 2). */
function buildSteps(planClass: PlanClass): WizardStep[] {
  const steps: WizardStep[] = [
    { id: "welcome", label: "Welcome" },
    { id: "plan", label: "Plan" },
    { id: "zones", label: "Zones" },
    { id: "rates", label: "Rate Rules" },
  ];
  if (planClass !== "FUNCTIONS_ONLY") {
    steps.push({ id: "carrier", label: "Carrier" });
  }
  steps.push({ id: "test-mode", label: "Test Mode" });
  steps.push({ id: "done", label: "Finish" });
  return steps;
}

function SetupWizard({ shopName, planClass, testMode, zones, draftRules }: SetupWizardProps) {
  const [open, setOpen] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const [zoneFormOpen, setZoneFormOpen] = useState(false);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [carrierOn, setCarrierOn] = useState(false);
  const [finishedBannerDismissed, setFinishedBannerDismissed] = useState(false);

  const zoneFetcher = useFetcher();
  const ruleFetcher = useFetcher();
  const completeFetcher = useFetcher();

  const steps = buildSteps(planClass);
  const safeStepIndex = Math.min(stepIndex, steps.length - 1);
  const step = steps[safeStepIndex];
  const isLast = safeStepIndex === steps.length - 1;
  const carrierOffered = planClass === "CCS_ELIGIBLE" || planClass === "ALL";

  const ruleBusy = ruleFetcher.state !== "idle";
  const completeBusy = completeFetcher.state !== "idle";
  const zoneReply = zoneFetcher.data as WizardActionReply | undefined;
  const ruleReply = ruleFetcher.data as WizardActionReply | undefined;
  const completeReply = completeFetcher.data as WizardActionReply | undefined;

  const zoneBusy = zoneFetcher.state !== "idle";
  const zoneServerError =
    !zoneBusy && zoneReply?.ok === false && zoneReply.message ? zoneReply.message : null;

  useEffect(
    function collapseZoneFormAfterDraft() {
      if (zoneFetcher.state === "idle" && zoneReply?.ok === true) {
        setZoneFormOpen(false);
      }
    },
    [zoneFetcher.state, zoneReply],
  );

  const ruleServerError =
    !ruleBusy && ruleReply?.ok === false && ruleReply.message ? ruleReply.message : null;

  useEffect(
    function collapseRuleFormAfterDraft() {
      if (ruleFetcher.state === "idle" && ruleReply?.ok === true) {
        setRuleFormOpen(false);
      }
    },
    [ruleFetcher.state, ruleReply],
  );

  useEffect(
    function closeWizardAfterCompletion() {
      if (completeFetcher.state === "idle" && completeReply?.ok === true) {
        setOpen(false);
      }
    },
    [completeFetcher.state, completeReply],
  );

  function hideWizard() {
    setOpen(false);
  }

  function goNext() {
    if (!isLast) {
      setStepIndex(safeStepIndex + 1);
    }
  }

  function goBack() {
    if (safeStepIndex > 0) {
      setStepIndex(safeStepIndex - 1);
    }
  }

  function openZoneForm() {
    setZoneFormOpen(true);
  }

  function closeZoneForm() {
    setZoneFormOpen(false);
  }

  function openRuleForm() {
    setRuleFormOpen(true);
  }

  function closeRuleForm() {
    setRuleFormOpen(false);
  }

  /** wizard-zone-create per the contract: JSON columns; enabled is forced
   * false server-side (draft semantics) so "0" is sent for clarity. */
  function submitZoneDraft(input: ZoneFormSubmitInput) {
    zoneFetcher.submit(
      {
        intent: "wizard-zone-create",
        name: input.name,
        enabled: "0",
        countries: JSON.stringify(input.countries),
        provinces: JSON.stringify(input.provinces),
        postalRules: JSON.stringify(input.postalRules),
      },
      { method: "post" },
    );
  }

  /** wizard-rule-create per the contract: JSON columns, stopOnMatch "1" or absent, zoneId raw or empty. */
  function submitRuleDraft(input: RuleFormSubmitInput) {
    const payload: Record<string, string> = {
      intent: "wizard-rule-create",
      name: input.name,
      kind: input.kind,
      priority: String(input.priority),
      zoneId: input.zoneId,
      conditions: JSON.stringify(input.conditions),
      action: JSON.stringify(input.action),
    };
    if (input.stopOnMatch) {
      payload.stopOnMatch = "1";
    }
    ruleFetcher.submit(payload, { method: "post" });
  }

  /** wizard-complete per the contract: carrier "1" only when offered and switched on. */
  function finishSetup() {
    const payload: Record<string, string> = { intent: "wizard-complete" };
    if (carrierOffered && carrierOn) {
      payload.carrier = "1";
    }
    completeFetcher.submit(payload, { method: "post" });
  }

  const zoneDraftCount = zones.filter(function isDraft(zone) {
    return !zone.enabled;
  }).length;
  const finishedOk = completeFetcher.state === "idle" && completeReply?.ok === true && !open;

  return (
    <>
      {finishedOk && !finishedBannerDismissed ? (
        <>
          <Banner
            tone="success"
            title="Setup Complete"
            onDismiss={function dismissFinished() {
              setFinishedBannerDismissed(true);
            }}
            action={{ content: "Open simulator", url: "/app/simulator" }}
          >
            <Text as="p" variant="bodySm">
              {completeReply?.message} Preview your rules in the{" "}
              <Link url="/app/simulator">Simulator</Link>, or open{" "}
              <Link url="/app/settings">Settings</Link> when you are ready to go live.
            </Text>
          </Banner>
          <SyncReportWarnings sync={completeReply?.sync ?? null} />
        </>
      ) : null}
      <Modal
        open={open}
        onClose={hideWizard}
        title="Set Up ShipMath"
        size="large"
        primaryAction={{
          content: isLast ? "Finish setup" : "Continue",
          onAction: isLast ? finishSetup : goNext,
          disabled: completeBusy,
          loading: isLast ? completeBusy : false,
        }}
        secondaryActions={[
          ...(safeStepIndex > 0
            ? [{ content: "Back", onAction: goBack, disabled: completeBusy }]
            : []),
          {
            content: isLast ? "Close without finishing" : "Skip for now",
            onAction: hideWizard,
            disabled: completeBusy,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="500">
            <WizardProgress steps={steps} currentIndex={safeStepIndex} />
            {step.id === "welcome" ? (
              <StepWelcome shopName={shopName} carrierStepIncluded={carrierOffered} />
            ) : null}
            {step.id === "plan" ? <StepPlanGuidance planClass={planClass} /> : null}
            {step.id === "zones" ? (
              <StepZones
                zones={zones}
                formOpen={zoneFormOpen}
                busy={zoneBusy}
                serverError={zoneServerError}
                fieldErrors={zoneReply?.fieldErrors ?? null}
                onOpenForm={openZoneForm}
                onCloseForm={closeZoneForm}
                onSubmitDraft={submitZoneDraft}
              />
            ) : null}
            {step.id === "rates" ? (
              <StepRates
                zones={zones}
                drafts={draftRules}
                formOpen={ruleFormOpen}
                busy={ruleBusy}
                serverError={ruleServerError}
                suggestedPriority={(draftRules.length + 1) * 10}
                onOpenForm={openRuleForm}
                onCloseForm={closeRuleForm}
                onSubmitDraft={submitRuleDraft}
              />
            ) : null}
            {step.id === "carrier" ? (
              <StepCarrier enabled={carrierOn} onChange={setCarrierOn} />
            ) : null}
            {step.id === "test-mode" ? <StepTestMode testMode={testMode} /> : null}
            {step.id === "done" ? (
              <StepDone
                ruleCount={draftRules.length}
                zoneDraftCount={zoneDraftCount}
                carrierOffered={carrierOffered}
                carrierOn={carrierOn}
                replyOk={completeReply ? completeReply.ok === true : null}
                replyMessage={completeReply?.message ?? null}
                sync={completeReply?.sync ?? null}
              />
            ) : null}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

export default SetupWizard;
