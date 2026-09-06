/**
 * Metafield operations on the delivery customization function owner (spec 002).
 * The owner GID comes from Shop.functionOwnerId (created by
 * app/services/function-owner.ts). NEVER set these on the shop — Function
 * input queries only read metafields from the function owner.
 */

export const SET_FUNCTION_METAFIELDS = `#graphql
  mutation SetFunctionMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const GET_FUNCTION_METAFIELDS = `#graphql
  query GetFunctionMetafields($ownerId: ID!) {
    node(id: $ownerId) {
      ... on DeliveryCustomization {
        id
        enabled
        config: metafield(namespace: "$app:delivery-customization", key: "function-configuration") {
          value
          type
        }
        variables: metafield(namespace: "$app:delivery-customization", key: "input-variables") {
          value
          type
        }
      }
    }
  }
`;
