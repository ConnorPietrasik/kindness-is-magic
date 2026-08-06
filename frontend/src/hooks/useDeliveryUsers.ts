/**
 * useDeliveryUsers — fetch all delivery-role users and expose them as a lookup map.
 *
 * Used by admin family pages to populate the "Delivery Person" selector.
 * React Query caches the result so concurrent usages share a single request.
 *
 * @example
 * ```tsx
 * const { deliveryUserMap, deliveryUsersLoading } = useDeliveryUsers();
 * <FamilyForm deliveryUserMap={deliveryUserMap} deliveryUsersLoading={deliveryUsersLoading} />
 * ```
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { adminListUsers } from "../lib/api";
import { adminUsers } from "../lib/queryKeys";

export function useDeliveryUsers(): {
  /** Map of delivery user id → display name (or email as fallback) */
  deliveryUserMap: Record<number, string>;
  /** True while the delivery users list is still loading */
  deliveryUsersLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: adminUsers,
    queryFn: () => adminListUsers({ page: 1, page_size: 200, roles: "delivery" }),
  });

  const deliveryUserMap = useMemo((): Record<number, string> => {
    const map: Record<number, string> = {};
    (data?.users ?? []).forEach((u) => {
      map[u.id] = u.display_name;
    });
    return map;
  }, [data]);

  return { deliveryUserMap, deliveryUsersLoading: isLoading };
}
