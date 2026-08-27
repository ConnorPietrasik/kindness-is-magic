/**
 * Family Wish List — Public Page
 *
 * Displays a family's wish list (family info + per-person wishes).
 * No authentication required. Accessible from admin and referrer views.
 * Shows claim UI for authenticated claim-capable users.
 */

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { ClaimModal } from "../components/ClaimModal";
import { HeaderBar } from "../components/HeaderBar";
import { PageSpinner } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th, Tr } from "../components/Table";
import { useAuth } from "../context/AuthContext";
import { getFamilyWishList } from "../lib/api";
import { familyWishList } from "../lib/queryKeys";
import { ROUTES, route } from "../lib/routes";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function FamilyWishList() {
  const { id } = useParams<{ id: string }>();
  const familyId = id ? parseInt(id, 10) : NaN;
  const { user, isClaimCapable } = useAuth();
  const location = useLocation();
  const [showClaimModal, setShowClaimModal] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: familyWishList(familyId),
    queryFn: () => getFamilyWishList(familyId),
    enabled: !Number.isNaN(familyId),
  });

  if (isLoading) return <PageSpinner />;

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <HeaderBar
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
        <main className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
          <h2 className="mb-2 text-xl font-bold text-gray-900">Family Not Found</h2>
          <p className="text-gray-500">This wish list doesn't exist or has been removed.</p>
          <Link to={ROUTES.ROOT} className="mt-4 inline-block text-sm font-medium text-violet-600 hover:underline">
            ← Back to home
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
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
        {/* Family header */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">{data.display_id}</h2>
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
                      {person.title ? `${person.title} ${person.given_name}` : person.given_name}
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
      <ClaimModal familyId={familyId} open={showClaimModal} onClose={() => setShowClaimModal(false)} currentLocation={location} />

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
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
