/**
 * DisplayId — renders a hierarchical display_id with clickable parts.
 *
 * Family format:  `{referrer_id}-{family_seq}`   (e.g. "2-1")
 * Person format:  `{referrer_id}-{family_seq}-{person_seq}` (e.g. "2-1-1")
 *
 * The referrer part links to the referrer's families page.
 * The family part links to the family's people page.
 *
 * Special / scoped values (PENDING, REJECTED, DELETED, single-segment)
 * are rendered as plain text.
 */

import { Link } from "react-router-dom";
import { route } from "../lib/routes";

interface DisplayIdProps {
  /** The display_id string from the API. */
  displayId: string;
  /** Database ID of the family (used for the family link). */
  familyId: number;
  /**
   * Database ID of the referrer. If omitted, the component attempts to
   * parse it from the first segment of the display_id string.
   */
  referrerId?: number | null;
}

const SPECIAL_VALUES = new Set(["PENDING", "REJECTED", "DELETED"]);

/**
 * Try to extract the referrer_id from a display_id string.
 * Returns the numeric first segment or null if it can't be parsed.
 */
function parseReferrerId(displayId: string): number | null {
  const first = displayId.split("-")[0];
  if (first == null) return null;
  const parsed = parseInt(first, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function DisplayId({ displayId, familyId, referrerId }: DisplayIdProps) {
  // Special / scoped values — render as-is
  if (SPECIAL_VALUES.has(displayId) || !displayId.includes("-")) {
    return <>{displayId}</>;
  }

  const segments = displayId.split("-");
  const resolvedReferrerId = referrerId ?? parseReferrerId(displayId);
  const hasReferrerLink = resolvedReferrerId != null && resolvedReferrerId > 0;

  // Family format: "R-F"
  if (segments.length === 2) {
    return (
      <>
        {hasReferrerLink ? (
          <Link to={route.adminReferrerFamilies(resolvedReferrerId!)} className="text-violet-600 transition-colors hover:text-violet-800">
            {segments[0]}
          </Link>
        ) : (
          segments[0]
        )}
        -
        <Link to={route.adminFamilyPeople(familyId)} className="text-violet-600 transition-colors hover:text-violet-800">
          {segments[1]}
        </Link>
      </>
    );
  }

  // Person format: "R-F-P"
  if (segments.length === 3) {
    return (
      <>
        {hasReferrerLink ? (
          <Link to={route.adminReferrerFamilies(resolvedReferrerId!)} className="text-violet-600 transition-colors hover:text-violet-800">
            {segments[0]}
          </Link>
        ) : (
          segments[0]
        )}
        -
        <Link to={route.adminFamilyPeople(familyId)} className="text-violet-600 transition-colors hover:text-violet-800">
          {segments[1]}
        </Link>
        -{segments[2]}
      </>
    );
  }

  // Fallback: render as plain text
  return <>{displayId}</>;
}
