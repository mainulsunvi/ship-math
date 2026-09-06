import { BlockStack, Card, Layout, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import ShipMathPage from "../components/global/ShipMathPage";

export default function SettingsPage() {
  return (
    <ShipMathPage title="Settings">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">
                General settings arrive with the next release.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </ShipMathPage>
  );
}
