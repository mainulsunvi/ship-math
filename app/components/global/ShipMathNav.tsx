import { Card, Layout, Tabs, Icon, Page } from "@shopify/polaris";
import { useState, useEffect } from "react";
import { useLocation } from "@remix-run/react";

import {
  HomeFilledIcon,
  ChartCohortIcon,
  PriceListFilledIcon,
  SendIcon,
  AppExtensionIcon,
} from "@shopify/polaris-icons";

export default function ShipMathNav() {
  const location = useLocation();
  const [selected, setSelected] = useState(0);

  const tabs = [
    {
      id: "dashboard",
      accessibilityLabel: "Dashboard",
      panelID: "dashboard-panel",
      url: "/app/dashboard",
      content: (
        <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
          <Icon source={HomeFilledIcon} />
          Dashboard
        </div>
      ),
    },
    {
      id: "bundles",
      accessibilityLabel: "Bundles",
      panelID: "bulk-pricing",
      url: "/app/bulk-pricing",
      content: (
        <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
          <Icon source={ChartCohortIcon} />
          Bulk Rules
        </div>
      ),
    },
    {
      id: "pricing",
      accessibilityLabel: "Pricing",
      panelID: "pricing-panel",
      url: "/app/pricing",
      content: (
        <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
          <Icon source={PriceListFilledIcon} />
          Plans
        </div>
      ),
    },
    {
      id: "contact-us",
      accessibilityLabel: "Contact Us",
      panelID: "contact-us-panel",
      url: "/app/contact",
      content: (
        <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
          <Icon source={SendIcon} />
          Contact Us
        </div>
      ),
    },
    // {
    // 	id: 'other-app',
    // 	accessibilityLabel: 'Other Apps',
    // 	panelID: 'other-apps-panel',
    // 	url: '/app/other-apps',
    // 	content: (
    // 		<div style={ { display: 'flex', alignItems: 'center', gap: '0.2rem' } }>
    // 			<Icon source={ AppExtensionIcon } />
    // 			Other Apps
    // 		</div>
    // 	),
    // },
  ];

  // Update selected tab based on current route
  useEffect(() => {
    const currentPath = location.pathname;
    let bulkPath = [
      "/app/bulk-pricing",
      "/app/bulk-pricing/new",
      "/app/bulk-pricing/edit",
      "/app/migrate-pricing-rules",
    ];
    const activeTabIndex = tabs.findIndex(
      (tab) =>
        currentPath.startsWith(tab.url) ||
        (tab.url === "/app/bulk-pricing" &&
          bulkPath.some((path) => currentPath.includes(path))),
    );

    if (activeTabIndex !== -1) {
      setSelected(activeTabIndex);
    } else {
      setSelected(0);
    }
  }, [location.pathname]);

  const handleTabChange = (selectedTabIndex : number) => {
    setSelected(selectedTabIndex);
  };

  return (
    <div className="quantible-custom-max-width">
      <Page>
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Tabs
                tabs={tabs}
                selected={selected}
                onSelect={handleTabChange}
                fitted
              />
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </div>
  );
}
