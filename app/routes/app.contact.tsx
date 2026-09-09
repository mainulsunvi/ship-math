import {
  BlockStack,
  Card,
  Layout,
  Text,
  TextField,
  Button,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import ShipMathPage from "../components/global/ShipMathPage";
import { Form } from "@remix-run/react";

export default function ContactPage() {
  return (
    <ShipMathPage title="Contact Us">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="subdued">
                We'd love to hear from you! Please fill out the form below and
                we'll get back to you as soon as possible.
              </Text>
              <Form method="post" action="/contact">
                <BlockStack gap="200">
                  <TextField
                    label="Name"
                    name="name"
                    autoComplete="name"
                    requiredIndicator
                  />
                  <TextField
                    label="Email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    requiredIndicator
                  />
                  <TextField
                    label="Message"
                    name="message"
                    multiline={4}
                    autoComplete="off"
                    requiredIndicator
                  />
                  <Button submit variant="primary">
                    Send message
                  </Button>
                </BlockStack>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </ShipMathPage>
  );
}
