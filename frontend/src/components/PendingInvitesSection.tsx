/**
 * PendingInvitesSection — collapsible list of unredeemed referrer invite codes.
 *
 * Shows which codes we are still "waiting on" (including lapsed ones, flagged
 * as expired so an admin can re-send). Read-only — revocation and full
 * management live on the Invite Codes page.
 *
 * Collapsed by default; follows the InternalNotesSection collapse pattern
 * (button header, rotating chevron, local expanded state). A fetch failure
 * is flagged in the header ("Failed to load") so it's visible while collapsed,
 * with the detail repeated in the expanded body.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { adminListInvites } from "../lib/api";
import { adminInvites } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";
import { formatDateTime } from "../lib/utils";
import { Table, TableBody, TableHead, Td, Th, Tr } from "./Table";

/**
 * Single bounded fetch of unredeemed codes. The bare `adminInvites` key means
 * any page that invalidates that prefix (generator create, invite-page revoke)
 * refreshes this list too. Expired-but-unredeemed codes are deliberately
 * included (no `expired` filter) so lapsed codes prompt a re-send.
 */
function usePendingInvites() {
  return useQuery({
    queryKey: adminInvites,
    queryFn: () => adminListInvites({ page: 1, page_size: 100, redeemed: false }),
  });
}

export function PendingInvitesSection() {
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError } = usePendingInvites();

  const total = data?.total ?? 0;
  const invites = data?.invites ?? [];
  const now = Date.now();

  return (
    <div className="mt-6">
      <button type="button" onClick={() => setExpanded((prev) => !prev)} className="flex w-full items-center justify-between text-left">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Pending invites</span>
          {isError ? (
            <span className="text-xs text-red-600">Failed to load</span>
          ) : total > 0 ? (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">{total}</span>
          ) : null}
        </div>
        <span
          className="text-gray-400 transition-transform duration-150"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
      </button>

      {expanded && (
        <div className="mt-3">
          {isLoading ? (
            <p className="text-sm text-gray-400">Loading pending invites…</p>
          ) : isError ? (
            <p className="text-sm text-gray-400">Could not load pending invites.</p>
          ) : invites.length === 0 ? (
            <p className="text-sm text-gray-400">No unredeemed invite codes.</p>
          ) : (
            <>
              <Table>
                <TableHead>
                  <Th>Code</Th>
                  <Th>Locked Email</Th>
                  <Th>Created</Th>
                  <Th>Expires</Th>
                </TableHead>
                <TableBody>
                  {invites.map((invite) => (
                    <Tr key={invite.id}>
                      <Td className="font-mono font-semibold">{invite.code}</Td>
                      <Td>{invite.locked_email ?? <span className="text-gray-400">—</span>}</Td>
                      <Td className="whitespace-nowrap text-sm text-gray-500">{formatDateTime(invite.created_at)}</Td>
                      <Td className="whitespace-nowrap text-sm text-gray-500">
                        {formatDateTime(invite.expires_at)}
                        {new Date(invite.expires_at).getTime() < now && (
                          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">Expired</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-2">
                <Link to={ROUTES.ADMIN_INVITE_CODES} className="text-sm text-blue-600 hover:underline">
                  Manage all invite codes
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
