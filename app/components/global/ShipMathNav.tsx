  import { Card, Layout, Tabs, Icon, Page } from "@shopify/polaris";
  import type { TabProps } from "@shopify/polaris";
  import { useState, useEffect } from "react";
  import { useLocation } from "@remix-run/react";

  import {
    HomeFilledIcon,
    ChartCohortIcon,
    PriceListFilledIcon,
    AdjustIcon,
    SendIcon,
    GlobeFilledIcon,
    SettingsFilledIcon,
  } from "@shopify/polaris-icons";

  export default function ShipMathNav() {
    const location = useLocation();
    const [selected, setSelected] = useState(0);

    const tabs = [
      {
        id: "dashboard",
        accessibilityLabel: "Dashboard",
        panelID: "dashboard",
        url: "/app",
        content: (
          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
            <Icon source={HomeFilledIcon} />
            Dashboard
          </div>
        ),
      },
      {
        id: "zones",
        accessibilityLabel: "Zones",
        panelID: "zones",
        url: "/app/zones",
        content: (
          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
            <Icon source={GlobeFilledIcon} />
            Zones
          </div>
        ),
      },
      {
        id: "Rules",
        accessibilityLabel: "Rules",
        panelID: "rules",
        url: "/app/rules",
        content: (
          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
            <Icon source={AdjustIcon} />
            Rules
          </div>
        ),
      },
      {
        id: "simulator",
        accessibilityLabel: "Rate simulator",
        panelID: "simulator",
        url: "/app/simulator",
        content: (
          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
            <Icon source={PriceListFilledIcon} />
            Simulator
          </div>
        ),
      },
      {
        id: "logs",
        accessibilityLabel: "Request log",
        panelID: "logs",
        url: "/app/logs",
        content: (
          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
            <Icon source={ChartCohortIcon} />
            Logs
          </div>
        ),
      },
      {
        id: "settings",
        accessibilityLabel: "Settings",
        panelID: "settings",
        url: "/app/settings",
        content: (
          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
            <Icon source={SettingsFilledIcon} />
            Settings
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
    ];

    // Update selected tab based on current route. Exact match first; then a
    // prefix match for sub-routes, with the root tab ("/app") excluded so it
    // can't shadow every /app/* path (otherwise Dashboard would always win).
    // Unknown paths fall back to the Dashboard tab.
    useEffect(() => {
      const currentPath = location.pathname;

      const exactIndex = tabs.findIndex((tab) => currentPath === tab.url);
      const prefixIndex =
        exactIndex !== -1
          ? exactIndex
          : tabs.findIndex(
              (tab) =>
                tab.url !== "/app" && currentPath.startsWith(`${tab.url}/`),
            );

      setSelected(prefixIndex !== -1 ? prefixIndex : 0);
    }, [location.pathname]);

    const handleTabChange = (selectedTabIndex: number): void => {
      setSelected(selectedTabIndex);
    };

    return (
      <div className="quantible-custom-max-width">
        <Page>
          <Layout>
            <Layout.Section>
              <Card padding="0">
                {/* Polaris types `content` as string, but Tabs renders ReactNode tab
              content fine at runtime. The cast keeps our custom (vertical) nav
              without restructuring the tabs into the icon-only API. */}
                <Tabs
                  tabs={tabs as unknown as TabProps[]}
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
