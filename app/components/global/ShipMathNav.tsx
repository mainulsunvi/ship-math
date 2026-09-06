import { Card, Layout, Tabs, Page } from "@shopify/polaris";
import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "@remix-run/react";

export default function ShipMathNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(0);

  const tabs = [
    {
      id: "dashboard",
      accessibilityLabel: "Dashboard",
      panelID: "dashboard-panel",
      url: "/app",
      content: "Dashboard",
    },
    {
      id: "additional",
      accessibilityLabel: "Additional",
      panelID: "additional-panel",
      url: "/app/additional",
      content: "Additional",
    },
    {
      id: "settings",
      accessibilityLabel: "Settings",
      panelID: "settings-panel",
      url: "/app/settings",
      content: "Settings",
    },
  ];

  // Update selected tab based on current route
  useEffect(() => {
    const currentPath = location.pathname;
    const activeTabIndex = tabs.findIndex(
      (tab) => currentPath === tab.url || currentPath.startsWith(`${tab.url}/`),
    );

    if (activeTabIndex !== -1) {
      setSelected(activeTabIndex);
    } else {
      setSelected(0);
    }
  }, [location.pathname]);

  const handleTabChange = (selectedTabIndex: number) => {
    setSelected(selectedTabIndex);
    navigate(tabs[selectedTabIndex].url);
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
