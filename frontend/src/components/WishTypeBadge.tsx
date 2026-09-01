import type { WishType } from "../types";

const wishTypeColors: Record<WishType, string> = {
  adult: "bg-purple-100 text-purple-700",
  practical: "bg-blue-100 text-blue-700",
  fun: "bg-amber-100 text-amber-700",
  family: "bg-teal-100 text-teal-700",
};

export function WishTypeBadge({ type }: { type: WishType }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${wishTypeColors[type]}`}>{type}</span>;
}
