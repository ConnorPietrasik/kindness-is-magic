/**
 * Default form shapes — empty / initial state objects for every entity
 * type. Centralised so pages don't drift apart.
 */

export const defaultPersonForm = {
  given_name: '',
  age: 0,
  title: '',
  practical_wish: '',
  fun_wish: '',
  note: '',
} as const;

export const defaultFamilyForm = {
  family_name: '',
  family_wish: '',
  contact_name: '',
  bio: '',
  address: '',
  phone_number: '',
} as const;

export const defaultReferrerForm = {
  name: '',
  family_limit: 1,
  phone_number: '',
} as const;
