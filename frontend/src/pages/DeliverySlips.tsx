/**
 * Delivery — Delivery Slips
 *
 * Print-optimized delivery slips (display ID, where to drive, family name,
 * contact, phone) scoped to the delivery person's assigned families.
 * Reuses the `deliveryFamilies` query — no dedicated endpoint. Rendering
 * (cards, empty/error states, print styles) is shared with the admin page
 * via `DeliverySlipsView`.
 */

import { useQuery } from "@tanstack/react-query";
import { Button } from "../components/Button";
import { DeliverySlipsView } from "../components/DeliverySlips";
import { BackLink, HeaderBar } from "../components/HeaderBar";
import { PageSpinner } from "../components/Spinner";
import { deliveryListFamilies } from "../lib/api";
import { deliveryFamilies } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";

export default function DeliverySlips() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: deliveryFamilies,
    queryFn: deliveryListFamilies,
  });

  if (isLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar
        left={<BackLink to={ROUTES.DELIVERY_DASHBOARD} label="Dashboard" />}
        right={
          <div className="no-print flex items-center gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              🖨️ Print
            </Button>
          </div>
        }
      />

      <DeliverySlipsView data={data} isError={isError} error={error} emptyMessage="No families are assigned to you yet." />
    </div>
  );
}
