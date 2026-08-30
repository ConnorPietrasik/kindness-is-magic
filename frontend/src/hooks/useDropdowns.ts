/**
 * Dropdown lookup hooks — minimal id/label lists for `<select>` fields and
 * id → label maps for table display.
 *
 * React Query caches each list, so concurrent usages share a single request.
 * Each hook returns the item array (empty while loading), an id → label map,
 * and a loading flag.
 *
 * @example
 * ```tsx
 * const { families, familyMap, familiesLoading } = useFamiliesDropdown();
 * <FamilyForm familyMap={familyMap} familyOptionsLoading={familiesLoading} />
 * ```
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { adminGetFamiliesDropdown, adminGetReferrersDropdown, adminGetUsersDropdown } from "../lib/api";
import { adminFamiliesDropdown, adminReferrersDropdown, adminUsersDropdownRoles } from "../lib/queryKeys";
import type { FamilyDropdownItem, ReferrerDropdownItem, UserDropdownItem } from "../types";

function toMap<T extends { id: number }>(items: T[], label: (item: T) => string): Record<number, string> {
  const map: Record<number, string> = {};
  items.forEach((item) => {
    map[item.id] = label(item);
  });
  return map;
}

/** All referrers for dropdown selects (id → name map). */
export function useReferrersDropdown(): {
  referrers: ReferrerDropdownItem[];
  referrerMap: Record<number, string>;
  referrersLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: adminReferrersDropdown,
    queryFn: adminGetReferrersDropdown,
  });

  const referrerMap = useMemo(() => toMap(data ?? [], (r) => r.name), [data]);
  return { referrers: data ?? [], referrerMap, referrersLoading: isLoading };
}

/** All families for dropdown selects (id → family_name map). */
export function useFamiliesDropdown(): {
  families: FamilyDropdownItem[];
  familyMap: Record<number, string>;
  familiesLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: adminFamiliesDropdown,
    queryFn: adminGetFamiliesDropdown,
  });

  const familyMap = useMemo(() => toMap(data ?? [], (f) => f.family_name), [data]);
  return { families: data ?? [], familyMap, familiesLoading: isLoading };
}

/** Users for dropdown selects, filtered by a comma-separated role list. */
export function useUsersDropdown(roles: string): {
  users: UserDropdownItem[];
  userMap: Record<number, string>;
  usersLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: adminUsersDropdownRoles(roles),
    queryFn: () => adminGetUsersDropdown(roles),
  });

  const userMap = useMemo(() => toMap(data ?? [], (u) => u.display_name), [data]);
  return { users: data ?? [], userMap, usersLoading: isLoading };
}
