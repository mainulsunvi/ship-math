/**
 * Carrier Service GraphQL operations (spec 007, architecture.md §A3).
 * Requires read_shipping / write_shipping scopes (added in the single batch
 * scope commit, plan 000). Field shapes follow the documented examples:
 *   - carrierServiceCreate → DeliveryCarrierServiceCreateInput
 *   - carrierServiceDelete(id) → { deletedId, userErrors }
 *   - carrierServices(first) → DeliveryCarrierService connection
 */

export const CREATE_CARRIER_SERVICE = `#graphql
  mutation CarrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
    carrierServiceCreate(input: $input) {
      carrierService {
        id
        name
        callbackUrl
        active
        supportsServiceDiscovery
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

export const DELETE_CARRIER_SERVICE = `#graphql
  mutation CarrierServiceDelete($id: ID!) {
    carrierServiceDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
` as const;

export const LIST_CARRIER_SERVICES = `#graphql
  query CarrierServiceList {
    carrierServices(first: 25) {
      edges {
        node {
          id
          name
          callbackUrl
          active
          supportsServiceDiscovery
        }
      }
    }
  }
` as const;
