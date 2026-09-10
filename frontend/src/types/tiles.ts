import { ROUTES } from "../lib/routes";

/** Dashboard navigation tile definition (drives the tile show/hide toggle). */
export interface DashboardTileDef {
  key: string; // stable slug used as the localStorage visibility key
  route: string; // destination — always a ROUTES constant
  icon: string;
  label: string;
  desc: string;
  visible: boolean; // shown by default; Reset restores the default-visible set
}

/**
 * Dashboard tiles per role. Defs order is the display order; the stored
 * visibility list is a set, never an order. Only roles with an entry here
 * get the tile toggle (currently admins only). A tile's `visible` flag sets
 * its default — shown on first visit and restored by Reset.
 */
export const DASHBOARD_TILES: Record<string, DashboardTileDef[]> = {
  admin: [
    { key: "users", route: ROUTES.ADMIN_USERS, icon: "👤", label: "Manage Users", desc: "Create, edit, delete users", visible: true },
    {
      key: "referrers",
      route: ROUTES.ADMIN_REFERRERS,
      icon: "👥",
      label: "Manage Referrers",
      desc: "Create, edit, delete referrers",
      visible: true,
    },
    {
      key: "families",
      route: ROUTES.ADMIN_FAMILIES,
      icon: "🏠",
      label: "Manage Families",
      desc: "Create, edit, delete families",
      visible: true,
    },
    { key: "people", route: ROUTES.ADMIN_PEOPLE, icon: "✨", label: "Manage People", desc: "Create, edit, delete people", visible: true },
    {
      key: "csv-upload",
      route: ROUTES.ADMIN_CSV_UPLOAD,
      icon: "📊",
      label: "CSV Import",
      desc: "Bulk-import referrers, families, people & users",
      visible: false, // mostly used for demo and testing — keep out of the way by default
    },
    {
      key: "invite-codes",
      route: ROUTES.ADMIN_INVITE_CODES,
      icon: "💌",
      label: "Invite Codes",
      desc: "Manage invite codes for self-registration",
      visible: true,
    },
    {
      key: "wish-review",
      route: ROUTES.ADMIN_WISH_REVIEW,
      icon: "📋",
      label: "Wish Approval",
      desc: "Approve or reject family wishes",
      visible: true,
    },
    {
      key: "deadlines",
      route: ROUTES.ADMIN_DEADLINES,
      icon: "📅",
      label: "Deadlines",
      desc: "Event deadlines: banners, reminders & enforcement",
      visible: true,
    },
    { key: "wishes", route: ROUTES.ADMIN_WISHES, icon: "🎁", label: "Manage Wishes", desc: "Assign & track gift purchases", visible: true },
    {
      key: "assigned-gifts",
      route: ROUTES.ADMIN_ASSIGNED_GIFTS,
      icon: "🛍️",
      label: "My Assigned Gifts",
      desc: "View and manage gifts assigned to you",
      visible: true,
    },
    {
      key: "packing-slips",
      route: ROUTES.ADMIN_PACKING_SLIPS,
      icon: "📦",
      label: "Packing Slips",
      desc: "Print packing slips for volunteers",
      visible: true,
    },
    {
      key: "delivery-slips",
      route: ROUTES.ADMIN_DELIVERY_SLIPS,
      icon: "🚚",
      label: "Delivery Slips",
      desc: "Print delivery slips for drivers",
      visible: true,
    },
    {
      key: "emails",
      route: ROUTES.ADMIN_EMAILS,
      icon: "📧",
      label: "Sent Emails",
      desc: "Full log of emails the app has sent",
      visible: true,
    },
    {
      key: "browse-families",
      route: ROUTES.PUBLIC_FAMILIES,
      icon: "🎯",
      label: "Browse Families",
      desc: "Browse and sponsor families",
      visible: true,
    },
  ],
};
