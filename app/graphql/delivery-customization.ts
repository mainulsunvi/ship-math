/**
 * Delivery customization owner lifecycle (spec 006 / architecture.md §A1).
 * ShipMath uses exactly ONE owner per shop; the app creates and heals it.
 * Requires the `write_delivery_customizations` + `read_delivery_customizations`
 * access scopes.
 */

export const CREATE_DELIVERY_CUSTOMIZATION = `#graphql
  mutation CreateDeliveryCustomization($input: DeliveryCustomizationInput!) {
    deliveryCustomizationCreate(deliveryCustomization: $input) {
      deliveryCustomization {
        id
        title
        enabled
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const LIST_DELIVERY_CUSTOMIZATIONS = `#graphql
  query ListDeliveryCustomizations($first: Int!) {
    deliveryCustomizations(first: $first) {
      nodes {
        id
        title
        enabled
      }
    }
  }
`;

export const UPDATE_DELIVERY_CUSTOMIZATION = `#graphql
  mutation UpdateDeliveryCustomization($id: ID!, $input: DeliveryCustomizationInput!) {
    deliveryCustomizationUpdate(id: $id, deliveryCustomization: $input) {
      deliveryCustomization {
        id
        enabled
      }
      userErrors {
        field
        message
      }
    }
  }
`;
