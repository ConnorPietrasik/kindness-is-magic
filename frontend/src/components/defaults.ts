/**
 * Default form shapes — empty / initial state objects for every entity
 * type. Centralised so pages don't drift apart.
 */

export const defaultPersonForm = {
  given_name: "",
  title: "",
  wish_description: "",
  wish_size: "",
  fun_wish_description: "",
  note: "",
  family_id: 0,
} as const;

export const defaultFamilyForm: FamilyFormState = {
  family_name: "",
  family_wish: "",
  contact_name: "",
  bio: null,
  address: null,
  phone_number: "",
  pickup_window: null,
  referrer_notes: null,
};

/** Shape of the form state used by FamilyForm.
 *
 * Nullable fields mirror FamilyDetail (null from server, "" from defaults).
 * The form renders them as `field || ""` for controlled inputs.
 */
export interface FamilyFormState {
  family_name: string;
  family_wish: string;
  contact_name: string;
  bio: string | null;
  address: string | null;
  phone_number: string;
  pickup_window: string | null;
  referrer_notes: string | null;
  // Admin-only fields (present when initial data includes them)
  referrer_id?: number | null;
  delivery_user_id?: number | null;
  deleted_at?: string | null;
}

export const defaultReferrerForm = {
  name: "",
  family_limit: 1,
  phone_number: "",
} as const;
