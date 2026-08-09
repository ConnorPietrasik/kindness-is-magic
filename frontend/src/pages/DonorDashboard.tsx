import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Card } from "../components/Card";
import { HeaderBar, LogoutButton } from "../components/HeaderBar";
import { PageSpinner } from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { donorListClaims } from "../lib/api";
import { donorClaims } from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";

const GIFT_CLAIM_CAP = 5;

export default function DonorDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  // Fetch claims to compute gift cap usage
  const { data: claims, isLoading } = useQuery({
    queryKey: donorClaims,
    queryFn: () => donorListClaims(),
    enabled: user?.role === "donor",
  });

  const giftClaimCount = claims?.filter((c) => c.commitment_type === "gifts" && c.fulfilled_at == null).length ?? 0;

  if (isLoading) return <PageSpinner />;

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar title="Kindness is Magic" right={<LogoutButton onClick={handleLogout} />} />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {/* Welcome card */}
        <Card className="mb-6">
          <h2 className="mb-2 text-lg font-semibold text-gray-900">Welcome, {user?.display_name ?? "Donor"}!</h2>
          <p className="text-sm text-gray-500">Browse families and claim them to help this holiday season.</p>
        </Card>

        {/* Gift claim cap */}
        <Card className="mb-6">
          <h3 className="mb-3 text-base font-semibold text-gray-900">Gift Claim Cap</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1 rounded-full bg-gray-200">
              <div
                className={`h-3 rounded-full transition-all ${giftClaimCount >= GIFT_CLAIM_CAP ? "bg-red-500" : "bg-gradient-to-r from-btn-start to-btn-end"}`}
                style={{ width: `${(giftClaimCount / GIFT_CLAIM_CAP) * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-gray-700">
              {giftClaimCount} / {GIFT_CLAIM_CAP}
            </span>
          </div>
          <p className="mt-2 text-xs text-gray-500">You can claim up to {GIFT_CLAIM_CAP} families for gifts. Cash claims are unlimited.</p>
        </Card>

        {/* Navigation cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          <NavCard to={ROUTES.DONOR_CLAIMS} icon="🎯" label="My Claims" desc="View and manage your claims" />
          <NavCard to={ROUTES.PUBLIC_FAMILIES} icon="🏠" label="Browse Families" desc="Find families needing gifts" />
        </div>
      </main>
    </div>
  );
}

interface NavCardProps {
  to: string;
  icon: string;
  label: string;
  desc: string;
}

function NavCard({ to, icon, label, desc }: NavCardProps) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-btn-start/40 hover:shadow-md"
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-sm font-semibold text-gray-900 group-hover:text-btn-start">{label}</span>
      <span className="text-xs text-gray-400">{desc}</span>
    </Link>
  );
}
