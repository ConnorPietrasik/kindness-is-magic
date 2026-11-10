import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type DragEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { DeadlineBanner } from "../components/DeadlineBanner";
import { FormField } from "../components/FormField";
import { HeaderBar } from "../components/HeaderBar";
import { InfoRow } from "../components/InfoRow";
import { MutationErrors } from "../components/MutationErrors";
import { PhoneInput } from "../components/PhoneInput";
import { PageSpinner } from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useDashboardTiles } from "../hooks/useDashboardTiles";
import { useDeadlineBanner } from "../hooks/useDeadlineBanner";
import {
  changePasswordRequest,
  donorListClaims,
  getReferrerMe,
  listAdminReviewQueue,
  listPendingFamilies,
  listReferrerReviewQueue,
  patchReferrerMe,
  updateMyProfile,
} from "../lib/api";
import {
  adminReviewQueue,
  auth,
  donorClaims,
  pendingFamilies as PENDING_FAMILIES_KEY,
  referrerMe,
  referrerReviewQueue,
} from "../lib/queryKeys";
import { ROUTES } from "../lib/routes";
import { formatDateTime, humanize, normalizeUpdatePayload } from "../lib/utils";
import { validatePhoneNumber } from "../lib/validators";
import type { ReferrerDetail, ReferrerPayload, UserRole } from "../types";

const GIFT_CLAIM_CAP = 5;

export default function Dashboard() {
  const { user } = useAuth();

  // Referrer-specific queries (only run when role is referrer)
  const { data: referrerInfo, isLoading: referrerLoading } = useQuery({
    queryKey: referrerMe,
    queryFn: getReferrerMe,
    enabled: user?.role === "referrer",
  });

  const { data: pendingFamilies } = useQuery({
    queryKey: PENDING_FAMILIES_KEY,
    queryFn: listPendingFamilies,
    enabled: user?.role === "referrer",
  });

  const { data: referrerReviewQueueData } = useQuery({
    queryKey: referrerReviewQueue,
    queryFn: listReferrerReviewQueue,
    enabled: user?.role === "referrer",
  });

  const { data: adminReviewQueueData } = useQuery({
    queryKey: adminReviewQueue,
    queryFn: listAdminReviewQueue,
    enabled: user?.role === "admin",
  });

  const { data: donorClaimsData, isLoading: donorClaimsLoading } = useQuery({
    queryKey: donorClaims,
    queryFn: () => donorListClaims(),
    enabled: user?.role === "donor",
  });

  const giftClaimCount = donorClaimsData?.filter((c) => c.commitment_type === "gifts" && c.fulfilled_at == null).length ?? 0;

  if ((user?.role === "referrer" && referrerLoading) || (user?.role === "donor" && donorClaimsLoading)) {
    return <PageSpinner />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <HeaderBar />

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {/* Profile card — inline display name edit + password change */}
        <ProfileCard />

        {/* Donor gift claim cap */}
        {user?.role === "donor" && (
          <Card className="mb-6">
            <h3 className="mb-3 text-base font-semibold text-gray-900">Gift Sponsorship Cap</h3>
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
            <p className="mt-2 text-xs text-gray-500">
              You can sponsor up to {GIFT_CLAIM_CAP} families for gifts. Cash sponsorships are unlimited.
            </p>
          </Card>
        )}

        {/* Referrer pending approval banner */}
        {user?.role === "referrer" && referrerInfo?.approval_status === "pending" && <PendingApprovalBanner />}

        {/* Referrer profile card */}
        {user?.role === "referrer" && referrerInfo && <ReferrerInfoCard referrerInfo={referrerInfo} />}

        {/* Referrer pending verification alert */}
        {user?.role === "referrer" && pendingFamilies && pendingFamilies.length > 0 && (
          <QueueAlert count={pendingFamilies.length} label="awaiting your verification" to={ROUTES.REFERRER_FAMILY_INVITES} tone="amber" />
        )}

        {/* Referrer wish review deadline banner */}
        {user?.role === "referrer" && <ReferrerReviewDeadlineBanner />}

        {/* Referrer wish review queue alert */}
        {user?.role === "referrer" && referrerReviewQueueData && referrerReviewQueueData.length > 0 && (
          <QueueAlert count={referrerReviewQueueData.length} label="awaiting your wish review" to={ROUTES.REFERRER_WISH_REVIEW} />
        )}

        {/* Admin wish review queue alert */}
        {user?.role === "admin" && adminReviewQueueData && adminReviewQueueData.length > 0 && (
          <QueueAlert count={adminReviewQueueData.length} label="awaiting your wish approval" to={ROUTES.ADMIN_WISH_REVIEW} />
        )}

        {/* Admin navigation tiles (per-admin show/hide) */}
        {user?.role === "admin" && <AdminTiles />}

        {/* Navigation cards */}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {user?.role === "referrer" && (
            <>
              <NavCard to={ROUTES.REFERRER_FAMILIES} icon="🏠" label="My Families" desc="Manage your verified families" />
              <NavCard to={ROUTES.REFERRER_FAMILY_INVITES} icon="⏳" label="Family Invites" desc="Invite families & review applications" />
              <NavCard to={ROUTES.REFERRER_WISH_REVIEW} icon="📋" label="Wish Review" desc="Review and approve family wishes" />
            </>
          )}

          {user?.role === "family" && (
            <NavCard to={ROUTES.FAMILY_DASHBOARD} icon="✨" label="My Family" desc="View your profile and manage people" />
          )}

          {user?.role === "purchaser" && (
            <>
              <NavCard to={ROUTES.PURCHASER_ASSIGNED_GIFTS} icon="🎁" label="Assigned Gifts" desc="View and manage your assigned gifts" />
              <NavCard to={ROUTES.PUBLIC_FAMILIES} icon="🎯" label="Browse Families" desc="Browse and sponsor families" />
            </>
          )}

          {user?.role === "delivery" && (
            <>
              <NavCard to={ROUTES.DELIVERY_DASHBOARD} icon="🏠" label="My Families" desc="View your assigned families" />
              <NavCard to={ROUTES.DELIVERY_PACKING_SLIPS} icon="📦" label="Packing Slips" desc="Print packing slips for delivery" />
            </>
          )}

          {user?.role === "donor" && (
            <>
              <NavCard to={ROUTES.DONOR_CLAIMS} icon="🎯" label="My Sponsorships" desc="View and manage your sponsorships" />
              <NavCard to={ROUTES.PUBLIC_FAMILIES} icon="🏠" label="Browse Families" desc="Find families needing gifts" />
            </>
          )}

          {/* Every role gets the help guide */}
          <NavCard to={ROUTES.HELP} icon="❓" label="Help" desc="Step-by-step guide for your role" />
        </div>
      </main>
    </div>
  );
}

/**
 * ProfileCard — profile section with inline display name edit and password change.
 */
function ProfileCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(user?.display_name ?? "");

  const updateProfileMut = useMutation({
    mutationFn: updateMyProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: auth });
    },
  });

  const roleColors: Record<UserRole, string> = {
    admin: "bg-red-600",
    referrer: "bg-blue-600",
    family: "bg-green-600",
    purchaser: "bg-orange-600",
    delivery: "bg-teal-600",
    donor: "bg-purple-600",
  };
  const badgeClass = `${roleColors[user?.role as UserRole] ?? "bg-gray-500"} inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white`;

  useEffect(() => {
    setValue(user?.display_name ?? "");
  }, [user?.display_name]);

  // Close edit mode when mutation settles (isPending goes from true → false)
  const prevPending = useRef(updateProfileMut.isPending);
  useEffect(() => {
    if (prevPending.current && !updateProfileMut.isPending && editing) {
      setEditing(false);
    }
    prevPending.current = updateProfileMut.isPending;
  }, [updateProfileMut.isPending, editing]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMut.mutate(value);
  };

  const handleCancel = () => {
    setEditing(false);
    setValue(user?.display_name ?? "");
  };

  const displayName = user?.display_name ?? "?";

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">Welcome back!</h2>
      {user?.role === "donor" && (
        <p className="mb-4 text-sm text-gray-500">Browse families and sponsor them to help this holiday season.</p>
      )}
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-btn-start to-btn-end text-lg font-bold text-white">
          {displayName[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={handleSave} className="flex items-center gap-2">
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                maxLength={40}
                autoComplete="off"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-base font-semibold text-gray-900 shadow-sm transition-colors focus:border-btn-start focus:outline-none"
                placeholder="e.g. John Smith"
                aria-label="Display name"
              />
              <Button type="submit" loading={updateProfileMut.isPending} className="h-8 px-3 text-xs">
                {updateProfileMut.isPending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="secondary" className="h-8 px-3 text-xs" onClick={handleCancel}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-gray-900">{displayName}</span>
              <span className={badgeClass} data-testid="role-badge">
                {humanize(user?.role)}
              </span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="ml-1 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                title="Edit display name"
              >
                ✏️
              </button>
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
            {user?.referrer_id && <span>Referrer ID: {user.referrer_id}</span>}
            {user?.family_id && <span>Family ID: {user.family_id}</span>}
          </div>
        </div>
      </div>
      {/* Password change */}
      <div className="mt-4 border-t border-gray-100 pt-3">
        <PasswordRow />
      </div>
      <MutationErrors mutations={[updateProfileMut]} />
    </Card>
  );
}

/**
 * ReferrerInfoCard — referrer profile info with invite code and inline self-edit.
 */
interface ReferrerInfoCardProps {
  referrerInfo: ReferrerDetail;
}

function ReferrerInfoCard({ referrerInfo }: ReferrerInfoCardProps) {
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);

  const updateSelfMut = useMutation({
    mutationFn: patchReferrerMe,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: referrerMe });
      setShowEdit(false);
    },
  });

  const familyLimit = referrerInfo.family_limit ?? 0;
  const familyCount = referrerInfo.family_count ?? 0;

  function handleUpdateSelf(formData: ReferrerPayload) {
    const payload = normalizeUpdatePayload(formData, referrerInfo);
    updateSelfMut.mutate(payload);
  }

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">Referrer Profile</h3>
        <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setShowEdit(!showEdit)}>
          {showEdit ? "Cancel" : "Edit"}
        </Button>
      </div>

      {showEdit ? (
        <ReferrerSelfForm
          initial={referrerInfo}
          onSubmit={handleUpdateSelf}
          onCancel={() => setShowEdit(false)}
          loading={updateSelfMut.isPending}
        />
      ) : (
        <div className="space-y-0">
          <InfoRow label="Name" value={referrerInfo.name} truncate={false} />
          <InfoRow label="Phone" value={referrerInfo.phone_number} truncate={false} />
          <InfoRow label="Pickup Window" value={formatDateTime(referrerInfo.pickup_window)} truncate={false} />
          <CopyableRow label="Family Invite Code" value={referrerInfo.family_invite_code} />
          <InfoRow label="Family Limit" value={`${familyCount} / ${familyLimit}`} isLast truncate={false} />
        </div>
      )}

      <MutationErrors mutations={[updateSelfMut]} />
    </Card>
  );
}

/**
 * ReferrerSelfForm — inline form for editing referrer name and phone.
 */
interface ReferrerSelfFormProps {
  initial: ReferrerDetail;
  onSubmit: (data: ReferrerPayload) => void;
  onCancel: () => void;
  loading: boolean;
}

function ReferrerSelfForm({ initial, onSubmit, onCancel, loading }: ReferrerSelfFormProps) {
  // State tracks only the fields this form edits — never the whole detail, so
  // unmanaged fields (id, pickup_window, ...) can't leak into the PATCH.
  const [form, setForm] = useState<ReferrerPayload>(() => ({
    name: initial.name,
    phone_number: initial.phone_number,
  }));
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    setForm({ name: initial.name, phone_number: initial.phone_number });
  }, [initial]);

  const update = (key: string, val: unknown) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <form
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        const phoneErr = validatePhoneNumber(form.phone_number || "");
        if (phoneErr) {
          setPhoneError(phoneErr);
          return;
        }
        setPhoneError(null);
        onSubmit(form);
      }}
      className="mx-auto max-w-sm space-y-3"
    >
      <FormField
        label="Name"
        fieldProps={{
          type: "text",
          value: form.name,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => update("name", e.target.value),
          required: true,
          maxLength: 60,
          autoComplete: "name",
        }}
      />
      <PhoneInput
        value={form.phone_number ?? ""}
        onChange={(val) => {
          update("phone_number", val);
          setPhoneError(null);
        }}
        error={phoneError}
      />
      <div className="flex gap-3 pt-1">
        <Button type="submit" loading={loading} className="flex-1">
          {loading ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * ReferrerReviewDeadlineBanner — the referrer_review deadline banner on the
 * referrer dashboard. Mounted only for referrers (via the role check in the
 * page), so the shared deadlines query is never fetched for other roles.
 * The queue count next to it comes from the QueueAlert below, so no `extra`.
 */
function ReferrerReviewDeadlineBanner() {
  const result = useDeadlineBanner("referrer_review");
  return <DeadlineBanner result={result} />;
}

/**
 * CopyableRow — label/value row with a copy-to-clipboard button.
 */
interface CopyableRowProps {
  label: string;
  value: string;
}

function CopyableRow({ label, value }: CopyableRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-baseline justify-between px-1 py-2 border-b border-gray-100">
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-gray-900">{value ?? "\u2014"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title={copied ? "Copied!" : "Copy to clipboard"}
        >
          {copied ? "✓" : "🗐"}
        </button>
      </div>
    </div>
  );
}

/**
 * NavCard — clickable nav card with icon, label and description.
 *
 * Optionally a drag source/target for the admin tile reordering: pass
 * `draggable` plus the handlers to get the grab cursor, dimmed drag state
 * and focus ring. The non-admin role nav cards pass none of these and stay
 * plain links.
 */
interface NavCardProps {
  to: string;
  icon: string;
  label: string;
  desc: string;
  /** Make this card draggable (admin tile reordering). */
  draggable?: boolean;
  /** Tooltip shown on drag-enabled cards. */
  dragTitle?: string;
  /** Stable key identifying the card (FLIP animation lookup). */
  tileKey?: string;
  /** Dimmed while this card is the one being dragged. */
  dragging?: boolean;
  onDragStart?: (e: DragEvent<HTMLAnchorElement>) => void;
  onDragOver?: (e: DragEvent<HTMLAnchorElement>) => void;
  onDrop?: (e: DragEvent<HTMLAnchorElement>) => void;
  onDragEnd?: (e: DragEvent<HTMLAnchorElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLAnchorElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Selection ring while this card is focused (click or Tab). */
  focused?: boolean;
}

function NavCard({
  to,
  icon,
  label,
  desc,
  draggable,
  dragTitle,
  tileKey,
  dragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onKeyDown,
  onFocus,
  onBlur,
  focused,
}: NavCardProps) {
  return (
    <Link
      to={to}
      data-tile-key={tileKey}
      {...(draggable && { draggable: true })}
      {...(dragTitle && { title: dragTitle })}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      className={`group flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-btn-start/40 hover:shadow-md ${
        draggable ? "cursor-grab select-none active:cursor-grabbing" : ""
      } ${dragging ? "opacity-50" : ""} ${focused ? "ring-2 ring-inset ring-btn-start/50" : ""}`}
    >
      <span className="text-2xl">{icon}</span>
      <span className="text-sm font-semibold text-gray-900 group-hover:text-btn-start">{label}</span>
      <span className="text-xs text-gray-400">{desc}</span>
    </Link>
  );
}

/**
 * AdminTiles — admin nav tile grid driven by the DASHBOARD_TILES registry,
 * with per-admin show/hide (gear popover) and drag-to-reorder, both
 * persisted to localStorage.
 *
 * Dragging reflows the grid LIVE: the dragged tile (dimmed) moves to its
 * would-be slot while the cursor is held and the other tiles slide out of
 * the way (FLIP, below), so the drop point is always visible. Releasing on
 * any tile commits the preview — Esc releases the drag the same way, so it
 * drops on whatever tile is under the pointer. Releasing (or Esc) outside
 * the grid reverts it. Hidden tiles hold their slot in the stored order
 * (useDashboardTiles).
 */
function AdminTiles() {
  const { visibleTiles, orderedTiles, defs, reorder, moveBy } = useDashboardTiles("admin");
  /** Key of the tile under an active drag (null when not dragging). */
  const [dragKey, setDragKey] = useState<string | null>(null);
  /**
   * Insertion index of the dragged tile within the visible tiles MINUS the
   * dragged tile; null until the first hover decides it. The grid renders
   * this preview — release commits it, cancel discards it.
   */
  const [dragInsert, setDragInsert] = useState<number | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const defByKey = new Map(defs.map((d) => [d.key, d]));
  const baseTiles = orderedTiles.flatMap((key) => {
    const def = defByKey.get(key);
    return def && visibleTiles.includes(def.key) ? [def] : [];
  });

  // Live drag preview: base order with the dragged tile at `dragInsert`
  // (its own slot until the first hover) — the grid the user sees is the
  // grid they will get on release.
  let tiles = baseTiles;
  if (dragKey) {
    const dragging = baseTiles.find((t) => t.key === dragKey);
    if (dragging) {
      const others = baseTiles.filter((t) => t.key !== dragKey);
      const insert = dragInsert ?? baseTiles.indexOf(dragging);
      tiles = [...others.slice(0, insert), dragging, ...others.slice(insert)];
    }
  }

  const gridRef = useRef<HTMLDivElement>(null);
  /** Layout position + slot (index among grid children) at the last commit — the FLIP baseline. */
  const lastRects = useRef(new Map<string, { x: number; y: number; slot: number }>());
  const animations = useRef(new Map<string, Animation>());

  // FLIP — slide tiles between layout positions, on every render.
  //
  // A tile animates only when its SLOT (index among the grid's children)
  // changed: that is what a reorder is. Layout shifts that keep every tile
  // in its slot (web-font swap, a banner appearing above the grid, window
  // resize) snap silently — this is what stops tiles "flying in" from a
  // stale baseline.
  //
  // The start point of each slide is the tile's VISUAL position before this
  // render (previous layout + in-flight transform offset — see below), so a
  // reorder landing mid-slide re-targets from where the tile visibly is:
  // rapid reflows (live dragging, hammered arrow keys) re-target smoothly
  // instead of restarting from a stale point and jittering.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const els = Array.from(grid.querySelectorAll<HTMLElement>("[data-tile-key]"));
    if (els.length === 0) return;

    const measure = () => {
      const m = new Map<string, { x: number; y: number; slot: number }>();
      els.forEach((el, slot) => {
        const key = el.dataset.tileKey;
        if (!key) return;
        // Document (not viewport) coordinates, so a scroll can't corrupt them.
        const r = el.getBoundingClientRect();
        m.set(key, { x: r.left - window.scrollX, y: r.top - window.scrollY, slot });
      });
      return m;
    };

    // "First" — current visual positions. The DOM is already at the NEW
    // layout here, so these are (new layout + in-flight transform offset).
    const firstNow = measure();
    const prevRects = lastRects.current;

    // Cancel the in-flight animations so "Last" is pure layout (and finished
    // entries don't accumulate). In-flight keys are remembered: a tile whose
    // slot didn't change but is mid-slide should finish its slide (e.g. the
    // moment a drag releases), not snap to the layout.
    const inFlight = new Set<string>();
    for (const [key, anim] of animations.current) {
      if (anim.playState === "finished") {
        animations.current.delete(key);
      } else {
        inFlight.add(key);
        anim.cancel();
      }
    }

    // "Last" — pure layout positions. `slot` is the tile's index among the
    // grid's children: it changes exactly when the tile's ORDER changes,
    // and stays put for layout shifts that don't reorder (web-font swap,
    // banner appearing above the grid, window resize) — those must snap,
    // not slide.
    const last = measure();
    lastRects.current = last;

    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    // A genuine reorder moves a tile by at most the grid's own width or
    // height. More than that means the stored baseline went stale without a
    // render (e.g. a font swap) — snap instead of flying the tile in.
    const gridRect = grid.getBoundingClientRect();
    const maxDx = gridRect.width;
    const maxDy = gridRect.height;

    els.forEach((el, slot) => {
      const key = el.dataset.tileKey;
      if (!key) return;
      const target = last.get(key);
      const first = firstNow.get(key);
      // Layout at the previous commit — where the tile sat before this render.
      const prev = prevRects.get(key);
      if (!target || !first || !prev) return;
      // Same slot, no in-flight slide (font/resize/banner shift): no slide.
      if (prev.slot === slot && !inFlight.has(key)) return;
      // The tile's VISUAL position before this render: its previous layout
      // plus the in-flight transform offset (zero when not animating). An
      // in-flight animation's offset rides on the element, so a layout change
      // moves the visual position with it — starting the new slide from this
      // point is what makes rapid re-targets (live-drag reflows) jump-free.
      const dx = prev.x + (first.x - target.x) - target.x;
      const dy = prev.y + (first.y - target.y) - target.y;
      if (dx === 0 && dy === 0) return;
      if (Math.abs(dx) > maxDx || Math.abs(dy) > maxDy) return;
      if (typeof el.animate !== "function") return; // jsdom (tests)
      animations.current.set(
        key,
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }], {
          duration: 180,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        })
      );
    });
  });

  /**
   * Set by an Esc keydown during the drag. Esc over a tile behaves like a
   * normal release (the browser fires `drop` and commits), so this only
   * matters for a dropless release that still lands inside the grid — over
   * a gap between tiles — which then reverts instead of committing the
   * last previewed slot.
   */
  const dragCancelled = useRef(false);

  // While a drag is active, watch for Esc: it releases the drag like the
  // mouse (drop → commit when over a tile), and this flag is what makes a
  // dropless Esc release over a grid gap revert instead of committing.
  useEffect(() => {
    if (!dragKey) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") dragCancelled.current = true;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragKey]);

  /** True when a viewport point sits inside the tiles grid. */
  function pointInGrid(point: { x: number; y: number }): boolean {
    let el: Element | null;
    try {
      el = document.elementFromPoint(point.x, point.y);
    } catch {
      el = null;
    }
    return !!el?.closest?.("[data-tile-grid]");
  }

  // A drag that starts anywhere in the grid that is NOT a tile (the grid
  // background, the gaps) would otherwise take a giant default drag image —
  // or a text-selection drag — and bypass the tile handlers entirely.
  // Cancel it before the browser builds any image.
  useEffect(() => {
    const guard = (e: globalThis.DragEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("[data-tile-grid]") && !t.closest?.("[data-tile-key]")) e.preventDefault();
    };
    window.addEventListener("dragstart", guard, true);
    return () => window.removeEventListener("dragstart", guard, true);
  }, []);

  function handleDragStart(e: DragEvent<HTMLAnchorElement>, key: string) {
    // Don't hijack drags that start inside interactive controls.
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, button")) {
      e.preventDefault();
      return;
    }
    setDragKey(key);
    setDragInsert(null);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      // The ghost must be exactly this tile, grabbed at the cursor. Relying
      // on the browser's default image lets some browsers ghost a much
      // larger region, which follows the cursor out of the window.
      if (typeof e.dataTransfer.setDragImage === "function") {
        const rect = e.currentTarget.getBoundingClientRect();
        e.dataTransfer.setDragImage(
          e.currentTarget,
          Math.round((e.clientX ?? rect.left + rect.width / 2) - rect.left),
          Math.round((e.clientY ?? rect.top + rect.height / 2) - rect.top)
        );
      }
    }
  }

  function handleDragOver(e: DragEvent<HTMLAnchorElement>, key: string) {
    if (!dragKey) return;
    // A valid drop target on EVERY tile, including the dragged one itself:
    // after the reflow the cursor usually rests over the dragged tile's new
    // slot, and releasing there must commit, not cancel.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (key === dragKey) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX ?? 0) < rect.left + rect.width / 2 ? "before" : "after";
    // Insertion index of `key` in the base order minus the dragged tile.
    const others = baseTiles.filter((t) => t.key !== dragKey);
    const hIdx = others.findIndex((t) => t.key === key);
    if (hIdx === -1) return;
    const insert = pos === "before" ? hIdx : hIdx + 1;
    // Render synchronously: while a native drag is in progress Chromium
    // delivers no rAF ticks, and a plain state update from a dragover (a
    // continuous event) would not paint until the next discrete event —
    // the grid must visibly make room as the cursor moves.
    flushSync(() => {
      setDragInsert((cur) => (cur === insert ? cur : insert));
    });
  }

  /** Commit the preview if the drag actually moved the tile. */
  function commitDrag() {
    if (!dragKey || dragInsert === null) return;
    const baseIndex = baseTiles.findIndex((t) => t.key === dragKey);
    if (baseIndex === -1 || dragInsert === baseIndex) return; // no move
    const others = baseTiles.filter((t) => t.key !== dragKey);
    // `dragInsert` is only set by a dragover over a real tile, so it indexes a
    // neighbor in `others`; the check keeps that invariant explicit (and bails
    // if state changed mid-drag) instead of relying on `!` assertions.
    if (dragInsert < 0 || dragInsert > others.length) return;
    const lastSlot = dragInsert === others.length;
    const target = lastSlot ? others[others.length - 1] : others[dragInsert];
    if (target) reorder(dragKey, target.key, lastSlot ? "after" : "before");
  }

  function handleDrop(e: DragEvent<HTMLAnchorElement>) {
    e.preventDefault();
    commitDrag();
    setDragKey(null);
    setDragInsert(null);
  }

  function handleDragEnd(e: DragEvent<HTMLAnchorElement>) {
    // A successful `drop` already committed and cleared the state. Reaching
    // here means the browser found no valid drop target — which happens even
    // for a perfectly good release, because after the reflow the cursor
    // usually rests over the moved drag tile and Chrome delivers no `drop`
    // there. So: commit when the pointer ended inside the grid; revert only
    // for an explicit Esc or a release outside it. The dragend event carries
    // the true release position — correct even after a mid-drag auto-scroll.
    if (dragKey && !dragCancelled.current && pointInGrid({ x: e.clientX, y: e.clientY })) {
      commitDrag();
    }
    dragCancelled.current = false;
    setDragKey(null);
    setDragInsert(null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLAnchorElement>, key: string) {
    // Arrow keys must keep their normal behavior inside inner controls —
    // only react when the tile itself is focused.
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveBy(key, -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      moveBy(key, 1);
    }
  }

  return (
    <div className="mb-6">
      <div className="mb-2 flex justify-end">
        <TileToggle roleKey="admin" />
      </div>
      <div ref={gridRef} data-tile-grid className="grid select-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <NavCard
            key={tile.key}
            to={tile.route}
            icon={tile.icon}
            label={tile.label}
            desc={tile.desc}
            draggable
            dragTitle="Drag to reorder"
            tileKey={tile.key}
            dragging={dragKey === tile.key}
            onDragStart={(e) => handleDragStart(e, tile.key)}
            onDragOver={(e) => handleDragOver(e, tile.key)}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onKeyDown={(e) => handleKeyDown(e, tile.key)}
            onFocus={() => setSelectedKey(tile.key)}
            onBlur={() => setSelectedKey((k) => (k === tile.key ? null : k))}
            focused={selectedKey === tile.key}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * TileToggle — gear icon button opening a popover with tile checkboxes.
 *
 * Uses useDashboardTiles internally. Unlike ColumnToggle, changes apply
 * immediately — tiles trigger no fetch, so there is no staged "Apply".
 * "Reset" restores the default-visible set AND the default order (same
 * full-reset semantics as ColumnToggle's Reset).
 */
interface TileToggleProps {
  /** Role whose DASHBOARD_TILES entry drives the toggle (e.g. "admin"). */
  roleKey: string;
}

function TileToggle({ roleKey }: TileToggleProps) {
  const { visibleTiles, toggleTile, resetTiles, defs } = useDashboardTiles(roleKey);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
        aria-label="Toggle dashboard tiles"
        title="Toggle dashboard tiles"
      >
        ⚙️
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl">
          <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Tiles</p>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {defs.map((tile) => (
              <label key={tile.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={visibleTiles.includes(tile.key)}
                  onChange={() => toggleTile(tile.key)}
                  className="rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                  autoComplete="off"
                />
                {tile.label}
              </label>
            ))}
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={resetTiles}
              className="w-full rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * PasswordRow — "Change password" button that expands into the password change form.
 */
function PasswordRow() {
  const toast = useToast();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");

  const resetFields = () => {
    setOldPass("");
    setNewPass("");
    setConfirmPass("");
  };

  const changePasswordMut = useMutation({
    mutationFn: () => changePasswordRequest(oldPass, newPass),
    onSuccess: async () => {
      toast.success("Password updated successfully!");
      resetFields();
      setEditing(false);
      // A password change invalidates all refresh tokens, so sign this session
      // out explicitly instead of stranding it until the next refresh failure.
      await logout();
      navigate(ROUTES.LOGIN, { replace: true });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (newPass !== confirmPass) {
      toast.error("New passwords do not match.");
      return;
    }

    changePasswordMut.mutate();
  };

  const handleCancel = () => {
    resetFields();
    setEditing(false);
  };

  return (
    <div>
      {editing ? (
        <form onSubmit={handleSubmit} className="max-w-sm space-y-3">
          <FormField
            label="Current password"
            type="password"
            fieldProps={{
              value: oldPass,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setOldPass(e.target.value),
              required: true,
              autoComplete: "current-password",
            }}
          />
          <FormField
            label="New password"
            type="password"
            fieldProps={{
              value: newPass,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setNewPass(e.target.value),
              required: true,
              minLength: 8,
              maxLength: 72,
              placeholder: "Min 8 characters",
              autoComplete: "new-password",
            }}
          />
          <FormField
            label="Confirm new password"
            type="password"
            fieldProps={{
              value: confirmPass,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => setConfirmPass(e.target.value),
              required: true,
              autoComplete: "new-password",
              minLength: 8,
              maxLength: 72,
            }}
          />
          <div className="flex gap-3">
            <Button type="submit" loading={changePasswordMut.isPending}>
              {changePasswordMut.isPending ? "Updating…" : "Update password"}
            </Button>
            <Button type="button" variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="secondary" className="h-8 px-3 text-xs" onClick={() => setEditing(true)}>
          Change password
        </Button>
      )}
      <MutationErrors mutations={[changePasswordMut]} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* QueueAlert — "N families awaiting …" link card                       */
/* ------------------------------------------------------------------ */

interface QueueAlertProps {
  count: number;
  /** Message after the count, e.g. "awaiting your wish review". */
  label: string;
  to: string;
  tone?: "amber" | "blue";
}

const queueAlertTones = {
  amber: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
  blue: "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100",
} as const;

function QueueAlert({ count, label, to, tone = "blue" }: QueueAlertProps) {
  return (
    <Link
      to={to}
      className={`mb-6 block rounded-xl border px-6 py-4 text-sm font-semibold shadow-sm transition-colors ${queueAlertTones[tone]}`}
    >
      {count} famil{count > 1 ? "ies" : "y"} {label} →
    </Link>
  );
}

/**
 * PendingApprovalBanner — dismissible banner for referrers awaiting approval.
 */
function PendingApprovalBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-amber-800">
          Your account is pending approval. You can explore your dashboard — you'll be able to send family invites once approved.
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 text-amber-500 transition-colors hover:text-amber-700"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
