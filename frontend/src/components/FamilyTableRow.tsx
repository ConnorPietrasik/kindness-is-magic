import { Link } from "react-router-dom";
import { route } from "../lib/routes";
import type { FamilyDetail } from "../types";
import { ActionsDropdown } from "./ActionsDropdown";
import { ApprovalBadge } from "./ApprovalBadge";
import { Button } from "./Button";
import { ClaimBadge } from "./ClaimBadge";
import { DisplayId } from "./DisplayId";
import { Td } from "./Table";

export interface FamilyTableRowProps {
  family: FamilyDetail;
  /** Visible column keys (from useColumnVisibility). */
  visibleColumns: string[];
  /** Whether the row is shown in the deleted tab. */
  isDeletedView: boolean;
  /** True when this row's inline edit form is open (button reads "Done"). */
  isEditing: boolean;
  /** Referrer display-name lookup (optional; falls back to "ID n"). */
  referrerMap?: Record<number, string>;
  /** Link Manage to the people page with ?from=referrer (referrer-scoped view). */
  fromReferrer?: boolean;
  /** Show "View Packing Slip" in the actions menu (admin families page). */
  showPackingSlipAction?: boolean;
  /** Toggles the row's inline edit form (open if closed, close if open). */
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onRestore: (id: number) => void;
  onResetLock: (id: number) => void;
  onFullyApprove: (id: number) => void;
  /** Required when `showPackingSlipAction` is set. */
  onViewPackingSlip?: (id: number) => void;
  isDeleting: boolean;
  isRestoring: boolean;
  /** True while a reset-lock / fully-approve mutation is in-flight (disables the menu). */
  isLockActionPending: boolean;
}

/**
 * FamilyTableRow — shared data cells + actions column for admin family tables.
 *
 * Renders the `<Td>` cells for a family row (driven by `visibleColumns`),
 * so every admin family table renders identical columns in a single order.
 * The surrounding `<Tr>` (with the lock-level row highlight from
 * `getLockLevelRowClass`), the header, and any expanded edit row stay with
 * the page/table that owns them.
 */
export function FamilyTableRow({
  family: f,
  visibleColumns,
  isDeletedView,
  isEditing,
  referrerMap,
  fromReferrer = false,
  showPackingSlipAction = false,
  onEdit,
  onDelete,
  onRestore,
  onResetLock,
  onFullyApprove,
  onViewPackingSlip,
  isDeleting,
  isRestoring,
  isLockActionPending,
}: FamilyTableRowProps) {
  return (
    <>
      {visibleColumns.includes("display_id") && (
        <Td className="whitespace-nowrap text-xs text-gray-400">
          <DisplayId displayId={f.display_id} familyId={f.id} referrerId={f.referrer_id} />
        </Td>
      )}
      {visibleColumns.includes("family_name") && (
        <Td className={f.deleted_at != null ? "text-gray-400" : ""}>
          {f.family_name}
          {f.deleted_at == null && f.referrer_notes != null && (
            <span className="ml-1 text-xs" title="Has internal notes">
              📝
            </span>
          )}
          {f.deleted_at == null && !isDeletedView && f.wish_lock_level === "admin" && (
            <Link
              to={route.familyWishList(f.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Wish List"
              className="ml-1 text-xs text-gray-400 transition-colors hover:text-violet-600"
              title="Wish List"
            >
              📄
            </Link>
          )}
        </Td>
      )}
      {visibleColumns.includes("family_wish") && <Td className="max-w-xs truncate">{f.family_wish ?? ""}</Td>}
      {visibleColumns.includes("contact_name") && <Td>{f.contact_name}</Td>}
      {visibleColumns.includes("referrer_id") && (
        <Td>
          {f.referrer_id != null ? (
            <Link
              to={route.adminReferrerFamilies(f.referrer_id)}
              className="text-sm text-violet-600 transition-colors hover:text-violet-800"
            >
              {f.referrer_name || referrerMap?.[f.referrer_id] || `ID ${f.referrer_id}`}
            </Link>
          ) : (
            "—"
          )}
        </Td>
      )}
      {visibleColumns.includes("delivery") && (
        <Td>{f.delivery_user_name || (f.delivery_user_id != null ? `ID ${f.delivery_user_id}` : "—")}</Td>
      )}
      {visibleColumns.includes("claim") && (
        <Td>
          {f.claim_status != null ? (
            <ClaimBadge
              status={f.claim_status}
              commitmentType={f.claim_commitment_type ?? ""}
              donorName={f.claim_donor_name ?? undefined}
              claimId={f.claim_id ?? undefined}
            />
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </Td>
      )}
      {visibleColumns.includes("phone_number") && <Td>{f.phone_number || "—"}</Td>}
      {visibleColumns.includes("person_count") && <Td className="whitespace-nowrap">{f.person_count ?? 0}</Td>}
      {visibleColumns.includes("verification_status") && (
        <Td>
          <ApprovalBadge status={f.verification_status} />
        </Td>
      )}
      {visibleColumns.includes("pickup_window") && <Td className="text-xs">{f.pickup_window || "—"}</Td>}
      {visibleColumns.includes("wish_lock_level") && (
        <Td>
          <span className="text-xs capitalize">{f.wish_lock_level}</span>
        </Td>
      )}
      {visibleColumns.includes("wish_review_requested_at") && (
        <Td className="text-xs text-gray-500">
          {f.wish_review_requested_at ? new Date(f.wish_review_requested_at).toLocaleDateString() : "—"}
        </Td>
      )}
      {visibleColumns.includes("wish_rejection_reason") && (
        <Td className="max-w-xs text-xs text-gray-500 truncate">{f.wish_rejection_reason || "—"}</Td>
      )}
      <Td>
        <div className="flex gap-2">
          {!isDeletedView && f.deleted_at == null && (
            <Link
              to={fromReferrer ? `${route.adminFamilyPeople(f.id)}?from=referrer` : route.adminFamilyPeople(f.id)}
              className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
            >
              Manage
            </Link>
          )}
          {!isDeletedView && f.deleted_at == null && (
            <>
              <Button variant="secondary" size="sm" className="px-3 py-1.5 text-xs" onClick={() => onEdit(f.id)}>
                {isEditing ? "Done" : "Edit"}
              </Button>
              <ActionsDropdown
                items={[
                  ...(showPackingSlipAction && onViewPackingSlip
                    ? [
                        {
                          label: "View Packing Slip",
                          onClick: () => onViewPackingSlip(f.id),
                        },
                      ]
                    : []),
                  ...(f.wish_lock_level !== "family"
                    ? [
                        {
                          label: "Reset Lock",
                          variant: "secondary" as const,
                          onClick: () => onResetLock(f.id),
                        },
                      ]
                    : []),
                  ...(f.wish_lock_level !== "admin"
                    ? [
                        {
                          label: "Fully Approve",
                          onClick: () => onFullyApprove(f.id),
                        },
                      ]
                    : []),
                  {
                    label: "Delete",
                    variant: "danger" as const,
                    onClick: () => onDelete(f.id),
                  },
                ]}
                disabled={isDeleting || isLockActionPending}
              />
            </>
          )}
          {isDeletedView && (
            <Button variant="secondary" size="sm" className="px-3 py-1.5 text-xs" onClick={() => onRestore(f.id)} disabled={isRestoring}>
              Restore
            </Button>
          )}
        </div>
      </Td>
    </>
  );
}
