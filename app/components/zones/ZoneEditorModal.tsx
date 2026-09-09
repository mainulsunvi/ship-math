import { useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import { Modal } from "@shopify/polaris";
import ZoneForm, { type ZoneFormSubmitInput, type ZoneFormZone } from "./ZoneForm";

/** Backwards-compatible alias (app.zones.tsx imports this name). */
export type { ZoneFormZone as ZoneEditorZone } from "./ZoneForm";

/**
 * Create AND edit zone modal (spec 004/005 Task 2) — modal, not a route.
 * Since 2026-09-10 this is a thin wrapper: ALL form fields, validation, and
 * the action row live in the shared ZoneForm (also embedded inline by the
 * setup wizard's Zones step), so the two surfaces cannot drift. The wrapper
 * owns the fetcher (zone-create / zone-update to the owning route; the
 * action re-validates the JSON columns and pushes the function mirror),
 * maps the reply into serverError/fieldErrors, and closes on success.
 */

interface FetcherReply {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

interface ZoneEditorModalProps {
  /** null = create a new zone. */
  zone: ZoneFormZone | null;
  onClose(): void;
}

/* (Form fields, option tables, and validation moved to ZoneForm.tsx.) */

export default function ZoneEditorModal({ zone, onClose }: ZoneEditorModalProps) {
  const fetcher = useFetcher();
  const submitResult = fetcher.data as FetcherReply | undefined;
  const busy = fetcher.state !== "idle";

  useEffect(
    function closeOnSuccess() {
      if (!busy && submitResult?.ok === true) {
        onClose();
      }
    },
    [busy, submitResult, onClose],
  );

  function handleSubmit(input: ZoneFormSubmitInput) {
    fetcher.submit(
      {
        intent: zone ? "zone-update" : "zone-create",
        ...(zone ? { id: zone.id } : {}),
        name: input.name,
        enabled: input.enabled ? "1" : "0",
        countries: JSON.stringify(input.countries),
        provinces: JSON.stringify(input.provinces),
        postalRules: JSON.stringify(input.postalRules),
      },
      { method: "post" },
    );
  }

  const serverError =
    !busy && submitResult?.ok === false && submitResult.message ? submitResult.message : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={zone ? `Edit zone: ${zone.name}` : "New zone"}
      size="large"
    >
      <Modal.Section>
        <ZoneForm
          zone={zone}
          submitLabel={zone ? "Save changes" : "Create zone"}
          busy={busy}
          serverError={serverError}
          fieldErrors={submitResult?.fieldErrors ?? null}
          onSubmit={handleSubmit}
          onCancel={onClose}
        />
      </Modal.Section>
    </Modal>
  );
}

