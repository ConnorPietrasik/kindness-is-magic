/**
 * WishLockBadge — colored badge showing the current wish lock level.
 *
 * Shared across admin, referrer, and family views.
 */

import type { WishLockLevel } from "../types";

const DEFAULT_COLORS: Record<WishLockLevel, string> = {
  family: "bg-gray-100 text-gray-600",
  referrer: "bg-blue-100 text-blue-700",
  admin: "bg-emerald-100 text-emerald-700",
};

const DEFAULT_LABELS: Record<WishLockLevel, string> = {
  family: "Editable",
  referrer: "Referrer reviewed",
  admin: "Admin approved",
};

interface WishLockBadgeProps {
  level: WishLockLevel;
  /** Override the default color classes per level. */
  colors?: Partial<Record<WishLockLevel, string>>;
  /** Override the default labels per level. */
  labels?: Partial<Record<WishLockLevel, string>>;
}

export function WishLockBadge({ level, colors, labels }: WishLockBadgeProps) {
  const colorMap = { ...DEFAULT_COLORS, ...colors };
  const labelMap = { ...DEFAULT_LABELS, ...labels };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${colorMap[level] ?? colorMap.family}`}>
      {labelMap[level] ?? level}
    </span>
  );
}
