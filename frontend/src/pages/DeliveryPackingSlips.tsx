/**
 * Delivery — Packing Slips
 *
 * Print-optimized packing slips scoped to the delivery person's assigned families.
 * Rendering (cards, empty/error states, print styles) is shared with the
 * admin page via `PackingSlipsView`.
 */

import { useQuery } from "@tanstack/react-query";
import { Button } from "../components/Button";
import { BackLink, HeaderBar, LogoutButton } from "../components/HeaderBar";
import { PackingSlipsView } from "../components/PackingSlips";
import { PageSpinner } from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { deliveryGetPackingSlips } from "../lib/api";
import { deliveryPackingSlips } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";

export default function DeliveryPackingSlips() {
  const { logout } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: deliveryPackingSlips,
    queryFn: deliveryGetPackingSlips,
  });

  if (isLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        title="Kindness is Magic"
        left={<BackLink to={ROUTES.DELIVERY_DASHBOARD} label="Dashboard" />}
        right={
          <div className="no-print flex items-center gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              🖨️ Print
            </Button>
            <LogoutButton onClick={logout} />
          </div>
        }
      />

      <PackingSlipsView data={data} isError={isError} error={error} emptyMessage="No families are assigned to you yet." />
    </div>
  );
}
