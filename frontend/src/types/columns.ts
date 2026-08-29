/** Column visibility registry for admin list tables. */

export interface ColumnDef {
  key: string; // backend field name
  label: string; // display label for the toggle UI
  visible: boolean; // default visibility (true = currently shown)
}

export const COLUMNS: Record<string, ColumnDef[]> = {
  adminReferrers: [
    { key: "name", label: "Name", visible: true },
    { key: "family_limit", label: "Family Limit", visible: true },
    { key: "phone_number", label: "Phone", visible: false },
    { key: "family_invite_code", label: "Invite Code", visible: false },
    { key: "approval_status", label: "Approval", visible: false },
    { key: "approved_by_admin_name", label: "Approved By", visible: false },
    { key: "approved_at", label: "Approved At", visible: false },
    { key: "created_at", label: "Created", visible: false },
  ],
  adminFamilies: [
    { key: "display_id", label: "ID", visible: true },
    { key: "family_name", label: "Family Name", visible: true },
    { key: "family_wish", label: "Family Wish", visible: true },
    { key: "contact_name", label: "Contact", visible: true },
    { key: "referrer_id", label: "Referrer", visible: true },
    { key: "delivery", label: "Delivery", visible: false },
    { key: "claim", label: "Claim", visible: false },
    { key: "phone_number", label: "Phone", visible: false },
    { key: "person_count", label: "Person Count", visible: false },
    { key: "verification_status", label: "Verification", visible: false },
    { key: "pickup_window", label: "Pickup Window", visible: false },
    { key: "wish_lock_level", label: "Lock Level", visible: false },
    { key: "wish_review_requested_at", label: "Review Requested", visible: false },
    { key: "wish_rejection_reason", label: "Rejection Reason", visible: false },
  ],
  adminPeople: [
    { key: "display_id", label: "ID", visible: true },
    { key: "given_name", label: "Name", visible: true },
    { key: "age", label: "Age", visible: true },
    { key: "wishes", label: "Wishes", visible: true },
    { key: "family_id", label: "Family", visible: true },
    { key: "role", label: "Role", visible: false },
    { key: "note", label: "Note", visible: false },
    { key: "created_at", label: "Created", visible: false },
  ],
  adminUsers: [
    { key: "email", label: "Email", visible: true },
    { key: "display_name", label: "Display Name", visible: true },
    { key: "role", label: "Role", visible: true },
    { key: "linked_to", label: "Linked To", visible: true },
    { key: "created_at", label: "Created", visible: true },
    { key: "referrer_id", label: "Referrer ID", visible: false },
    { key: "family_id", label: "Family ID", visible: false },
  ],
  adminWishes: [
    { key: "person_given_name", label: "Person", visible: true },
    { key: "family_id", label: "Family", visible: true },
    { key: "type", label: "Type", visible: true },
    { key: "description", label: "Description", visible: true },
    { key: "size", label: "Size", visible: true },
    { key: "assigned_to", label: "Assigned To", visible: true },
    { key: "purchased_at", label: "Purchased", visible: true },
    { key: "purchased_where", label: "Purchased Where", visible: false },
    { key: "received_at", label: "Received At", visible: false },
    { key: "purchaser_note", label: "Purchaser Note", visible: false },
  ],
  adminInvites: [
    { key: "code", label: "Code", visible: true },
    { key: "family_limit", label: "Family Limit", visible: true },
    { key: "locked_email", label: "Locked Email", visible: true },
    { key: "created_by_admin_name", label: "Created By", visible: true },
    { key: "created_at", label: "Created", visible: true },
    { key: "redeemed", label: "Redeemed", visible: true },
    { key: "referrer_approval_status", label: "Status", visible: true },
  ],
  adminSentEmails: [
    { key: "recipient_email", label: "Recipient", visible: true },
    { key: "kind", label: "Kind", visible: true },
    { key: "status", label: "Status", visible: true },
    { key: "sender_name", label: "Sender", visible: true },
    { key: "sent_at", label: "Sent", visible: true },
  ],
};

/** Column key → backend field names (for aliases that need multiple fields). */
export const COLUMN_FIELD_MAP: Record<string, string[]> = {
  linked_to: ["referrer_name", "family_name"],
  referrer_id: ["referrer_id", "referrer_name"],
  delivery: ["delivery_user_id", "delivery_user_name"],
  claim: ["claim_status", "claim_commitment_type", "claim_donor_name", "claim_id"],
  assigned_to: ["assigned_to_id", "assigned_to_name"],
  redeemed: ["redeemed", "redeemed_by_referrer_name"],
  status: ["status", "failure_reason"],
};
