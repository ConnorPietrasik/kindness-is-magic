import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { HeaderBar } from "../components/HeaderBar";
import { PageError } from "../components/PageError";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { donorListClaims } from "../lib/api";
import { donorClaims } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { formatDateTime } from "../lib/utils";
import type { FamilyClaimSummary } from "../types";
import { getClaimStatus } from "../types";

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "fulfilled", label: "Fulfilled" },
];

export default function DonorClaims() {
  const [statusFilter, setStatusFilter] = useState<string>("");

  const {
    data: claims,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: [...donorClaims, statusFilter],
    queryFn: () =>
      donorListClaims(statusFilter === "active" ? { fulfilled: false } : statusFilter === "fulfilled" ? { fulfilled: true } : undefined),
  });

  if (isLoading) return <PageSpinner />;

  if (isError || !claims) {
    return (
      <div className="min-h-screen bg-slate-50">
        <HeaderBar title="Kindness is Magic" />
        <PageError error={error} heading="Unable to Load Claims" fallback="Something went wrong. Please try again later." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-violet-950">My Claims</h2>
          <div className="flex items-center gap-3">
            <select
              aria-label="Claim status filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition-colors focus:border-btn-start focus:ring-2 focus:ring-btn-start/20"
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <Link
              to={ROUTES.PUBLIC_FAMILIES}
              className="inline-flex items-center rounded-lg bg-gradient-to-r from-btn-start to-btn-end px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              + Browse Families
            </Link>
          </div>
        </div>

        {claims.length === 0 ? (
          <Card className="py-12 text-center">
            <p className="text-gray-500">You haven't claimed any families yet.</p>
            <Link to={ROUTES.PUBLIC_FAMILIES} className="mt-3 inline-block text-sm font-medium text-btn-start hover:underline">
              Browse families to claim →
            </Link>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <Th>Family</Th>
              <Th>Status</Th>
              <Th>Commitment</Th>
              <Th>Created</Th>
              <Th>Actions</Th>
            </TableHead>
            <TableBody>
              {claims.map((claim) => (
                <ClaimRow key={claim.id} claim={claim} />
              ))}
            </TableBody>
          </Table>
        )}
      </main>
    </div>
  );
}

function ClaimRow({ claim }: { claim: FamilyClaimSummary }) {
  return (
    <Tr data-id={claim.id}>
      <Td>
        <Link to={route.donorClaimDetail(claim.id)} className="font-medium text-btn-start hover:underline">
          {claim.family.display_id}
        </Link>
        {claim.family.bio && <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{claim.family.bio}</p>}
      </Td>
      <Td>
        <StatusBadge status={getClaimStatus(claim.fulfilled_at)} />
      </Td>
      <Td>
        <CommitmentBadge type={claim.commitment_type} />
      </Td>
      <Td className="text-xs text-gray-500">{formatDateTime(claim.created_at)}</Td>
      <Td>
        <Link
          to={route.donorClaimDetail(claim.id)}
          className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          View
        </Link>
      </Td>
    </Tr>
  );
}

function StatusBadge({ status }: { status: "active" | "fulfilled" }) {
  const cls = status === "fulfilled" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800";

  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${cls}`}>{status}</span>;
}

function CommitmentBadge({ type }: { type: string }) {
  const cls = type === "cash" ? "bg-amber-100 text-amber-800" : "bg-purple-100 text-purple-800";

  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${cls}`}>{type}</span>;
}
