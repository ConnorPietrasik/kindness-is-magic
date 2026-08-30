/**
 * useDeliveryUsers — fetch all delivery-role users and expose them as a lookup map.
 *
 * Used by admin family pages to populate the "Delivery Person" selector.
 * Thin wrapper around `useUsersDropdown("delivery")` keeping the established
 * return shape.
 *
 * @example
 * ```tsx
 * const { deliveryUserMap, deliveryUsersLoading } = useDeliveryUsers();
 * <FamilyForm deliveryUserMap={deliveryUserMap} deliveryUsersLoading={deliveryUsersLoading} />
 * ```
 */

import { useUsersDropdown } from "./useDropdowns";

export function useDeliveryUsers(): {
  /** Map of delivery user id → display name (or email as fallback) */
  deliveryUserMap: Record<number, string>;
  /** True while the delivery users list is still loading */
  deliveryUsersLoading: boolean;
} {
  const { userMap, usersLoading } = useUsersDropdown("delivery");
  return { deliveryUserMap: userMap, deliveryUsersLoading: usersLoading };
}
