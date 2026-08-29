/**
 * Family Wish List — Public Page
 *
 * Displays a family's wish list (family info + per-person wishes).
 * No authentication required. Accessible from admin and referrer views.
 * Shows claim UI for authenticated claim-capable users.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { ClaimModal } from "../components/ClaimModal";
import { HeaderBar } from "../components/HeaderBar";
import { Logo } from "../components/Logo";
import { PageError } from "../components/PageError";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useAuth } from "../context/AuthContext";
import { getFamilyWishList } from "../lib/api";
import { familyWishList } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";
import { personRoleLabel } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function FamilyWishList() {
  const { id } = useParams<{ id: string }>();
  const familyId = id ? parseInt(id, 10) : NaN;
  const { user, isClaimCapable } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // One-shot flag set by donor self-registration when the user got here by
  // trying to claim this family: open the claim modal on arrival.
  const openClaimRequested = location.state?.openClaim === true;
  const [showClaimModal, setShowClaimModal] = useState(false);

  useEffect(() => {
    if (openClaimRequested && isClaimCapable) {
      setShowClaimModal(true);
    }
  }, [openClaimRequested, isClaimCapable]);

  const closeClaimModal = () => {
    setShowClaimModal(false);
    // Clear the one-shot flag so back/forward navigation doesn't reopen the modal.
    if (openClaimRequested) {
      navigate(location.pathname, { replace: true, state: null });
    }
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: familyWishList(familyId),
    queryFn: () => getFamilyWishList(familyId),
    enabled: !Number.isNaN(familyId),
  });

  if (isLoading) return <PageSpinner />;

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <HeaderBar
          className="no-print"
          title="Kindness is Magic"
          titleTo={user ? ROUTES.DASHBOARD : ROUTES.PUBLIC_FAMILIES}
          left={<BackToFamilies />}
          right={
            user ? (
              <span className="text-sm text-white/80">{user.display_name}</span>
            ) : (
              <Link to={ROUTES.LOGIN} className="text-sm text-white/80 transition-colors hover:text-white">
                Sign in
              </Link>
            )
          }
        />
        <PageError
          error={error}
          heading="Unable to Load Wish List"
          fallback="This wish list doesn't exist or has been removed."
          to={ROUTES.ROOT}
          linkLabel="← Back to home"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        className="no-print"
        title="Kindness is Magic"
        titleTo={user ? ROUTES.DASHBOARD : ROUTES.PUBLIC_FAMILIES}
        left={<BackToFamilies />}
        right={
          user ? (
            <span className="text-sm text-white/80">{user.display_name}</span>
          ) : (
            <Link to={ROUTES.LOGIN} className="text-sm text-white/80 transition-colors hover:text-white">
              Sign in
            </Link>
          )
        }
      />

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* Branded header — print only */}
        <div className="print-only mb-6 items-center gap-4 border-b border-gray-200 pb-4">
          <Logo className="h-14 w-14" />
          <div className="text-left">
            <div className="text-lg font-bold text-gray-900">{data.display_id}</div>
            <div className="text-sm text-gray-500">Kindness is Magic — Family Wish List</div>
          </div>
        </div>

        {/* Family header */}
        <div className="mb-8">
          <h2 className="no-print text-2xl font-bold tracking-tight text-gray-900">{data.display_id}</h2>
          {data.bio && <p className="mt-2 text-gray-600">{data.bio}</p>}
          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
            <h3 className="text-sm font-semibold text-violet-900">Family Wish</h3>
            <p className="mt-1 text-sm text-violet-800">{data.family_wish}</p>
          </div>
        </div>

        {/* People wishes */}
        <h3 className="mb-3 text-base font-semibold text-gray-900">Family Members</h3>

        {data.people.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white py-8 text-center text-gray-400 shadow-sm">
            No family members added yet.
          </div>
        ) : (
          <Table>
            <TableHead>
              <Th>Name</Th>
              <Th>Age</Th>
              <Th>Practical Wish</Th>
              <Th>Fun Wish</Th>
              {hasNotes(data.people) && <Th>Note</Th>}
            </TableHead>
            <TableBody>
              {data.people.map((person, idx) => {
                const activeWishes = person.wishes.filter((w) => !w.deleted_at);
                const practicalOrAdult = activeWishes.find((w) => w.type === "practical" || w.type === "adult");
                const fun = activeWishes.find((w) => w.type === "fun");
                const isAdult = person.age >= 18;
                return (
                  <Tr key={idx}>
                    <Td className="font-medium text-gray-900">
                      {personRoleLabel(person.role)} {person.given_name}
                    </Td>
                    <Td>{person.age}</Td>
                    {isAdult ? (
                      <Td colSpan={2} className="max-w-xs">
                        {practicalOrAdult
                          ? `${practicalOrAdult.description}${practicalOrAdult.size ? ` (${practicalOrAdult.size})` : ""}`
                          : "—"}
                      </Td>
                    ) : (
                      <>
                        <Td className="max-w-xs">
                          {practicalOrAdult
                            ? `${practicalOrAdult.description}${practicalOrAdult.size ? ` (${practicalOrAdult.size})` : ""}`
                            : "—"}
                        </Td>
                        <Td className="max-w-xs">{fun ? `${fun.description}${fun.size ? ` (${fun.size})` : ""}` : "—"}</Td>
                      </>
                    )}
                    {hasNotes(data.people) && <Td className="max-w-xs text-gray-500">{person.note ?? "—"}</Td>}
                  </Tr>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Claim section */}
        <div className="mt-8">
          {user && isClaimCapable ? (
            data.claimed_by_current_user ? (
              // Already claimed — show status + link to detail
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-emerald-800 capitalize">{data.claim_status ?? "active"} Claim</span>
                  {data.claim_id != null && (
                    <Link to={route.donorClaimDetail(data.claim_id)} className="text-sm font-medium text-emerald-700 hover:underline">
                      View claim details →
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              // Claim-capable, not yet claimed
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="mb-3 text-sm text-gray-600">Would you like to claim this family and help fulfill their wishes?</p>
                <Button onClick={() => setShowClaimModal(true)}>Claim this family</Button>
              </div>
            )
          ) : user ? // Authenticated but not claim-capable (family role) — no UI
          null : (
            // Not authenticated — show sign in / register prompt
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm text-gray-600">
                Sign in or create a free account to claim this family and help fulfill their wishes.
              </p>
              <Button onClick={() => setShowClaimModal(true)}>Claim this family</Button>
            </div>
          )}
        </div>
      </main>

      {/* Claim modal */}
      <ClaimModal familyId={familyId} open={showClaimModal} onClose={closeClaimModal} currentLocation={location} />

      {/* Print styles */}
      <style>{`
        .print-only { display: none; }
        @media print {
          .no-print { display: none !important; }
          .print-only { display: flex !important; }
          body { background: white; }
          table { border-collapse: collapse !important; }
          th, td { border: 1px solid #d1d5db !important; padding: 0.5rem !important; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function hasNotes(people: { note: string | null }[]): boolean {
  return people.some((p) => p.note != null && p.note.length > 0);
}

function BackToFamilies() {
  return (
    <Link to={ROUTES.PUBLIC_FAMILIES} className="no-print text-sm text-white/80 transition-colors hover:text-white">
      ← Back
    </Link>
  );
}
