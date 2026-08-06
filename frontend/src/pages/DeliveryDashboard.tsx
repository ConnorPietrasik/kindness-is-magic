/**
 * Delivery — Dashboard
 *
 * Shows assigned families as info cards and links to packing slips.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { HeaderBar, LogoutButton } from "../components/HeaderBar";
import { PageSpinner } from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { deliveryListFamilies } from "../lib/api";
import { deliveryFamilies } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";
import type { DeliveryFamilySummary } from "../types";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function DeliveryDashboard() {
  const { user, logout } = useAuth();

  const {
    data: families,
    isLoading,
    isError,
  } = useQuery({
    queryKey: deliveryFamilies,
    queryFn: deliveryListFamilies,
  });

  if (isLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" right={<LogoutButton onClick={logout} />} />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {/* Welcome */}
        <Card className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900">Welcome, {user?.display_name ?? "Delivery Person"}!</h2>
          <p className="mt-1 text-sm text-gray-500">
            You are assigned to <strong>{families?.length ?? 0}</strong> family{families?.length !== 1 ? "ies" : ""}.
          </p>
        </Card>

        {/* Packing slips shortcut */}
        <div className="mb-6">
          <Link to={ROUTES.DELIVERY_PACKING_SLIPS}>
            <Button className="w-full sm:w-auto">📦 View Packing Slips</Button>
          </Link>
        </div>

        {/* Assigned families */}
        <h3 className="mb-3 text-base font-semibold text-gray-900">Assigned Families</h3>

        {isError || !families ? (
          <Card>
            <p className="py-8 text-center text-gray-400">Unable to load families. Please try again.</p>
          </Card>
        ) : families.length === 0 ? (
          <Card>
            <p className="py-8 text-center text-gray-400">No families assigned yet. Contact an admin to get started.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {families.map((family) => (
              <FamilyCard key={family.id} family={family} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FamilyCard — info card for one assigned family                      */
/* ------------------------------------------------------------------ */

interface FamilyCardProps {
  family: DeliveryFamilySummary;
}

function FamilyCard({ family }: FamilyCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-gray-900">{family.family_name}</span>
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">#{family.display_id}</span>
          </div>
          <div className="mt-1 space-y-0.5 text-sm text-gray-500">
            {family.address && <p className="truncate">{family.address}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>{family.contact_name}</span>
              {family.phone_number && <span>{family.phone_number}</span>}
              <span>{family.person_count === 1 ? "1 person" : `${family.person_count} people`}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
