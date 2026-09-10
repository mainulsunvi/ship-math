import { Box, Page } from "@shopify/polaris";
import type { PageProps } from "@shopify/polaris";
import type { ReactNode } from "react";

interface ShipMathPageProps {
  title: string;
  subtitle?: string;
  primaryAction?: PageProps["primaryAction"];
  secondaryActions?: PageProps["secondaryActions"];
  backAction?: PageProps["backAction"];
  children: ReactNode;
  titleMetadata?: ReactNode[];
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
  backAction,
  children,
  titleMetadata,
}: ShipMathPageProps) {
  return (
    <Box>
      <Page
        title={title}
        subtitle={subtitle}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        backAction={backAction}
        titleMetadata={[...(titleMetadata ?? [])]}
      >
        {children}
      </Page>
    </Box>
  );
}
