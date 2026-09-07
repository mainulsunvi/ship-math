/**
 * Directory queries for the simulator pickers (spec 008): real customers,
 * shop locations, and the shop's presentation currency. Each is fail-soft at
 * the call site — a scope or permission problem yields an empty list, and the
 * merchant falls back to the manual form/dummy options.
 */

export const CUSTOMERS_QUERY = `#graphql
  query SimulatorCustomers {
    customers(first: 25, sortKey: CREATED_AT) {
      nodes {
        id
        displayName
        tags
      }
    }
  }
`;

export const LOCATIONS_QUERY = `#graphql
  query SimulatorLocations {
    locations(first: 50) {
      nodes {
        id
        name
        isActive
      }
    }
  }
`;

export const SHOP_QUERY = `#graphql
  query SimulatorShop {
    shop {
      currencyCode
    }
  }
`;

/**
 * The store's own shipping setup: delivery profiles → location group zones →
 * zones (country coverage) + method definitions (static prices and their
 * price/weight conditions). Validated against the 2025-10 and 2026-01 Admin
 * schemas — `code` is an OBJECT there ({countryCode, restOfWorld}), not a
 * union, and methodDefinitions hang off the location-group zone, not the zone.
 *
 * COST: the unpaginated shape (first: 20/50/100) costs ~1500 points — over
 * Shopify's 1000-point single-query limit. This variant pages 2 profiles per
 * request (capped inner lists: 20 zones, 20 methods), so every request stays
 * far under the limit; the caller walks pageInfo until every profile is read.
 */
export const DELIVERY_PROFILES_QUERY = `#graphql
  query DeliveryProfilesWithZones($after: String) {
    deliveryProfiles(first: 2, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        profileLocationGroups {
          locationGroupZones(first: 20) {
            edges {
              node {
                zone {
                  id
                  name
                  countries {
                    provinces {
                      code
                    }
                    code {
                      countryCode
                      restOfWorld
                    }
                  }
                }
                methodDefinitions(first: 20) {
                  edges {
                    node {
                      id
                      name
                      active
                      methodConditions {
                        field
                        operator
                        conditionCriteria {
                          ... on MoneyV2 {
                            amount
                          }
                          ... on Weight {
                            value
                            unit
                          }
                        }
                      }
                      rateProvider {
                        ... on DeliveryRateDefinition {
                          price {
                            amount
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;
