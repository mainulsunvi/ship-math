import { Page } from "@shopify/polaris";
import type { PageProps } from "@shopify/polaris";
import type { ReactNode } from "react";

interface ShipMathPageProps {
  title: string;
  subtitle?: string;
  primaryAction?: PageProps["primaryAction"];
  secondaryActions?: PageProps["secondaryActions"];
  children: ReactNode;
}

/**
 * Shared page shell for every app.* route. Thin pass-through around Polaris
 * Page so all routes get consistent headers (title/subtitle/actions) for
 * free. No logic lives here.
 */
export default function ShipMathPage({
  title,
  subtitle,
  primaryAction,
  secondaryActions,
  children,
}: ShipMathPageProps) {
  return (
    <Page
      title={title}
      subtitle={subtitle}
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
    >
      {children}
    </Page>
  );
}
